// POST /api/auth/google — Google Sign-In.
//
// SECURITY: the client must send the Google-issued `credential` (a signed ID
// token from Google Identity Services). We verify it against Google's tokeninfo
// endpoint and take the identity ONLY from Google's response — never from
// client-supplied email/name fields. Trusting a client-sent email here would be
// a complete authentication bypass (anyone could log in as anyone).
import { withApi, json } from "../../_lib/core/respond.js";
import { createSessionToken, sessionCookieHeader } from "../../_lib/core/session.js";
import { sanitizeInput } from "../../_lib/core/security.js";
import { hashPassword } from "../../_lib/core/auth.js";
import { checkRateLimit } from "../../_lib/core/rateLimit.js";
import { adminEmailList, isAdminEmail } from "../../_lib/core/adminEmails.js";
import { lookupAccountForGoogle, trialSeatUsage } from "../../_lib/core/db.js";
import { logError } from "../../_lib/core/errorLog.js";

// Same text for every "we won't create/link an account for this address" case
// (P38 admin-provision refusal + P41 password-account refusal) so the endpoint
// stays a non-oracle: it never tells a prober which of the two applies, or
// whether the address is admin.
const EXISTING_ACCOUNT_MSG =
  "هذا البريد مسجّل مسبقاً بحساب كلمة مرور — سجّل الدخول بكلمة المرور، وإذا نسيتها استخدم «نسيت كلمة المرور».";

const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo?id_token=";

/**
 * Verify a Google ID token. Returns { email, name, sub } or null.
 * Checks signature/expiry via Google, then pins the audience to our own
 * GOOGLE_CLIENT_ID so a token minted for a different app can't be replayed here.
 */
async function verifyGoogleIdToken(env, credential) {
  const res = await fetch(`${TOKENINFO_URL}${encodeURIComponent(credential)}`);
  if (!res.ok) return null;
  const info = await res.json().catch(() => null);
  if (!info || !info.email) return null;

  // Google only returns tokeninfo for valid, unexpired, correctly-signed tokens,
  // but the audience must still be pinned to this application.
  if (!env?.GOOGLE_CLIENT_ID || info.aud !== env.GOOGLE_CLIENT_ID) return null;
  if (info.email_verified !== "true" && info.email_verified !== true) return null;

  return { email: String(info.email).toLowerCase(), name: info.name || "", sub: String(info.sub || "") };
}

async function googleAuthHandler(body, env, request, requestId, context) {
  const clientIp =
    request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "127.0.0.1";
  const rateCheck = await checkRateLimit(env, clientIp, "google_auth", 10, 60);
  if (!rateCheck.allowed) {
    return json({ ok: false, error: `محاولات كثيرة جداً. حاول بعد ${rateCheck.resetInSeconds} ثانية.` }, 429);
  }

  if (!env?.GOOGLE_CLIENT_ID) {
    return json({ ok: false, error: "تسجيل الدخول بجوجل غير مفعّل حالياً.", code: "GOOGLE_NOT_CONFIGURED" }, 503);
  }

  const credential = (body?.credential || "").toString();
  if (!credential) {
    return json({ ok: false, error: "بيانات اعتماد جوجل مفقودة." }, 400);
  }

  const identity = await verifyGoogleIdToken(env, credential).catch(() => null);
  if (!identity) {
    return json({ ok: false, error: "تعذر التحقق من حساب جوجل." }, 401);
  }

  const email = sanitizeInput(identity.email, 200);
  const name = sanitizeInput(identity.name || "تاجر أورا", 100);
  let merchantId = `m_g_${identity.sub.slice(0, 16)}`;

  if (env?.DB) {
    // P41 — PRE-HIJACK. Signup never verifies that the address belongs to the
    // person signing up (no email_verified anywhere in this project), so an
    // existing PASSWORD account is an unproven claim on this address: an
    // attacker who signed up with the victim's email would be handed a shared
    // account the moment the real owner used Google. We only sign into an
    // account that Google itself created (merchant_id `m_g_…`); a password
    // account is never auto-linked. Failing to READ the row is ambiguity, and
    // ambiguity refuses — never a silent merge, never a fresh parallel account.
    let account;
    try {
      account = await lookupAccountForGoogle(env, email);
    } catch (err) {
      logError(context, {
        requestId,
        path: "/api/auth/google",
        code: "GOOGLE_ACCOUNT_LOOKUP_FAILED",
        internal: String(err?.message || err)
      });
      return json(
        { ok: false, error: "تعذر التحقق من الحساب حالياً. حاول بعد قليل.", code: "ACCOUNT_LOOKUP_FAILED" },
        503
      );
    }

    if (account.exists && !account.isGoogleAccount) {
      logError(context, {
        requestId,
        path: "/api/auth/google",
        code: "GOOGLE_LINK_REFUSED_PASSWORD_ACCOUNT",
        internal: "google sign-in refused: an unverified password account already holds this address (P41)",
        storeId: account.merchantId
      });
      return json({ ok: false, error: EXISTING_ACCOUNT_MSG, code: "PASSWORD_ACCOUNT_EXISTS" }, 409);
    }

    if (account.exists) {
      merchantId = account.merchantId;
    } else if (isAdminEmail(env, email)) {
      // P38 — this branch AUTO-PROVISIONS an `accounts` row, and an admin
      // address in that table is full admin (requireAdmin matches the email
      // against ADMIN_EMAILS; there is no is_admin column). Google verifying
      // the address is not enough: ADMIN_EMAILS may list an address on a domain
      // we do not control, or a Google Workspace address whose mailbox is held
      // by someone else. An admin whose account already exists still signs in
      // above; only the create-on-first-sign-in path is refused. Same generic
      // message as elsewhere — no enumeration.
      return json({ ok: false, error: EXISTING_ACCOUNT_MSG, code: "PASSWORD_ACCOUNT_EXISTS" }, 409);
    } else {
      // P59/G4 — this branch CREATES an account, so it must consume a trial
      // seat exactly like signup.js. Before today it created merchants with no
      // cap at all: Google sign-in bypassed the 20-seat limit entirely AND
      // raised the counter, pushing COUNT(*) past 20 and locking every real
      // password signup out with a permanent 403. An account-creating path
      // that doesn't count is a total bypass — worse than disposable emails.
      //
      // No email normalization here on purpose: the address comes verified from
      // Google, and Google itself refuses to mint two accounts that differ only
      // by dots or a `+tag`, so the alias trick has nothing to work with. The
      // existing exact lookup above (P41/P38) stays untouched.
      const TRIAL_MERCHANT_CAP = 20;
      let seats;
      try {
        seats = await trialSeatUsage(env, "", adminEmailList(env));
      } catch (err) {
        logError(context, {
          requestId,
          path: "/api/auth/google",
          code: "GOOGLE_SEAT_LOOKUP_FAILED",
          internal: String(err?.message || err)
        });
        return json(
          { ok: false, error: "تعذر إنشاء الحساب حالياً. حاول بعد قليل.", code: "SEAT_LOOKUP_FAILED" },
          503
        );
      }
      if (seats.count >= TRIAL_MERCHANT_CAP) {
        return json(
          {
            ok: false,
            error: "خلصت مقاعد التجربة المجانية حالياً — تواصل معنا وبنسجلك بأول مقعد يفتح.",
            code: "TRIAL_FULL"
          },
          403
        );
      }

      // First Google sign-in for this address: provision merchant + account.
      // The password is random and unusable — this account signs in via Google.
      const randomBytes = new Uint8Array(32);
      crypto.getRandomValues(randomBytes);
      const unusablePassword = Array.from(randomBytes, (b) => b.toString(16).padStart(2, "0")).join("");
      const { hash, salt } = await hashPassword(unusablePassword);
      await env.DB.prepare("INSERT OR IGNORE INTO merchants (id, store_name) VALUES (?, ?)")
        .bind(merchantId, name)
        .run()
        .catch(() => {});
      await env.DB.prepare(
        "INSERT OR IGNORE INTO accounts (merchant_id, email, password_hash, password_salt) VALUES (?, ?, ?, ?)"
      )
        .bind(merchantId, email, hash, salt)
        .run()
        .catch(() => {});
    }
  }

  const isAdmin = isAdminEmail(env, email);
  const token = await createSessionToken(env, merchantId);

  return json(
    { ok: true, storeId: merchantId, email, storeName: name, isAdmin },
    200,
    { "Set-Cookie": sessionCookieHeader(token) }
  );
}

export const onRequestPost = withApi(googleAuthHandler);

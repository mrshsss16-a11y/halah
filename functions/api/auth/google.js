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
import { isAdminEmail } from "../../_lib/core/adminEmails.js";

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

async function googleAuthHandler(body, env, request) {
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
    const account = await env.DB.prepare("SELECT merchant_id FROM accounts WHERE email = ?")
      .bind(email)
      .first()
      .catch(() => null);

    if (account?.merchant_id) {
      merchantId = account.merchant_id;
    } else if (isAdminEmail(env, email)) {
      // P38 — this branch AUTO-PROVISIONS an `accounts` row, and an admin
      // address in that table is full admin (requireAdmin matches the email
      // against ADMIN_EMAILS; there is no is_admin column). Google verifying
      // the address is not enough: ADMIN_EMAILS may list an address on a domain
      // we do not control, or a Google Workspace address whose mailbox is held
      // by someone else. An admin whose account already exists still signs in
      // above; only the create-on-first-sign-in path is refused. Same generic
      // message as elsewhere — no enumeration.
      return json({ ok: false, error: "هذا البريد مسجّل مسبقاً — سجّل دخول بدل ذلك." }, 409);
    } else {
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

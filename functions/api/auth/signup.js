// POST /api/auth/signup — body: { email, password, storeName? }
// Creates a merchant + account, sets the session cookie. One step, two
// fields — minimum friction (Commitment & Consistency: small first ask).
import { json } from "../../_lib/core/respond.js";
import { assertTrustedWrite } from "../../_lib/core/csrf.js";
import { hashPassword } from "../../_lib/core/auth.js";
import { createSessionToken, sessionCookieHeader } from "../../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { sanitizeInput } from "../../_lib/core/security.js";
import { adminEmailList, isAdminEmail } from "../../_lib/core/adminEmails.js";
import { trialSeatUsage } from "../../_lib/core/db.js";
import { logError } from "../../_lib/core/errorLog.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost(context) {
  const { request, env } = context;
  // P42 — CSRF gate (Origin allowlist + JSON-only body) for this raw handler.
  try {
    assertTrustedWrite(request, env);
  } catch (err) {
    return json({ ok: false, error: err.message, code: err.code || "CSRF_REJECTED" }, err.status || 403);
  }

  // Cap signups per IP — the 20-seat trial cap otherwise doubles as a lockout
  // DoS (20 scripted POSTs fill every seat) (SECURITY_AUDIT C2/H10).
  const rl = await checkRateLimit(env, clientIp(request), "signup", 3, 3600);
  if (!rl.allowed) {
    return json({ ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "طلب غير صالح." }, 400);
  }

  const email = (body.email || "").toString().trim().toLowerCase().slice(0, 200);
  const password = (body.password || "").toString();
  // Sanitize store name at the source: it renders in the admin accounts table
  // (SECURITY_AUDIT C3 stored XSS). Escaping at the sink is the primary fix;
  // this is defence in depth.
  const storeName = sanitizeInput((body.storeName || "").toString().trim(), 100) || null;

  if (!EMAIL_RE.test(email)) {
    return json({ ok: false, error: "أدخل بريد إلكتروني صحيح." }, 400);
  }
  if (password.length < 8) {
    return json({ ok: false, error: "كلمة المرور لازم تكون ٨ أحرف على الأقل." }, 400);
  }

  // P38 — never let self-service signup create an account with an address that
  // ADMIN_EMAILS grants admin to. requireAdmin() matches the accounts.email
  // column against that secret, so such a row IS full admin. Until now the only
  // thing standing in the way was the accidental 409 below (both admin
  // addresses happen to be registered already); an admin address that is NOT
  // yet in `accounts` was a free admin account for whoever signed up first.
  // Same generic message + status as "email already taken" so this endpoint
  // can't be used to enumerate which addresses are admin.
  if (isAdminEmail(env, email)) {
    return json({ ok: false, error: "هذا البريد مسجّل مسبقاً — سجّل دخول بدل ذلك." }, 409);
  }

  // P59/G4 — duplicate check AND seat count both run on the NORMALIZED address
  // (lowercase, `+tag` stripped, dots removed for gmail.com only). The old
  // literal `WHERE email = ?` let one mailbox take all 20 seats via
  // `me+1@gmail.com`, `me+2@…`, `m.e@gmail.com` … See normalizeEmailForDedupe
  // in _lib/core/db.js for why dots are a Gmail-only rule.
  //
  // Trial registration cap (docs/ROADMAP.md m2.2.5, 2026-08-07): the free-tier
  // AI capacity behind every merchant is shared, not per-merchant — 15-20
  // active stores is the real ceiling before the account-wide free quota
  // (Cloudflare/Groq/OpenRouter combined) runs dry every day. Admin accounts
  // don't count against it.
  const TRIAL_MERCHANT_CAP = 20;
  let seats;
  try {
    seats = await trialSeatUsage(env, email, adminEmailList(env));
  } catch (err) {
    // Fail closed: an unreadable accounts table is not "zero accounts".
    try {
      logError(context, {
        path: "/api/auth/signup",
        code: "SIGNUP_SEAT_LOOKUP_FAILED",
        internal: String(err?.message || err)
      });
    } catch {
      // نفس الـDB المعطوب هو سبب الخطأ — لا نُسقط الرد بسببه.
    }
    return json(
      { ok: false, error: "تعذر إنشاء الحساب حالياً. حاول بعد قليل.", code: "SEAT_LOOKUP_FAILED" },
      503
    );
  }

  if (seats.duplicate) {
    return json({ ok: false, error: "هذا البريد مسجّل مسبقاً — سجّل دخول بدل ذلك." }, 409);
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

  const merchantId = `m_${crypto.randomUUID().slice(0, 12)}`;
  const { hash, salt } = await hashPassword(password);

  await env.DB.batch([
    env.DB.prepare("INSERT INTO merchants (id, store_name) VALUES (?, ?)").bind(merchantId, storeName),
    env.DB.prepare(
      "INSERT INTO accounts (merchant_id, email, password_hash, password_salt) VALUES (?, ?, ?, ?)"
    ).bind(merchantId, email, hash, salt)
  ]);

  const token = await createSessionToken(env, merchantId);
  return json(
    { ok: true, storeId: merchantId, email },
    200,
    { "Set-Cookie": sessionCookieHeader(token) }
  );
}

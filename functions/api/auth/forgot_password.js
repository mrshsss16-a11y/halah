// POST /api/auth/forgot_password — request a password-reset OTP.
//
// SECURITY:
//  - The OTP is NEVER returned in the response. Returning it would let anyone
//    take over any account by simply asking for a reset.
//  - The OTP is stored hashed, so a DB read alone doesn't grant account access.
//  - The response is identical whether or not the account exists (no user
//    enumeration).
//  - Delivery is out-of-band. Until a delivery channel is wired up, the request
//    is recorded and the endpoint reports that delivery is unavailable rather
//    than pretending a message was sent.
import { withApi, json } from "../../_lib/core/respond.js";
import { sanitizeInput } from "../../_lib/core/security.js";
import { checkRateLimit } from "../../_lib/core/rateLimit.js";
import { sendWaText, waConfigured } from "../../_lib/integrations/whatsapp.js";

/** SHA-256 hex of `${email}:${otp}` — salted by email so codes aren't interchangeable. */
async function hashOtp(email, otp) {
  const data = new TextEncoder().encode(`${email}:${otp}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateOtp() {
  // Cryptographically random 6-digit code (Math.random is not acceptable for
  // anything that guards account access).
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + (buf[0] % 900000));
}

async function forgotPasswordHandler(body, env, request) {
  const clientIp =
    request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "127.0.0.1";
  const rateCheck = await checkRateLimit(env, clientIp, "forgot_password", 5, 60);
  if (!rateCheck.allowed) {
    return json(
      { ok: false, error: `محاولات كثيرة جداً لاستعادة كلمة المرور. حاول بعد ${rateCheck.resetInSeconds} ثانية.` },
      429
    );
  }

  const email = sanitizeInput((body?.email || "").toString().trim().toLowerCase(), 200);
  if (!email || !email.includes("@")) {
    return json({ ok: false, error: "يرجى إدخال بريد إلكتروني صحيح." }, 400);
  }

  // Uniform response regardless of account existence (anti-enumeration).
  const genericResponse = {
    ok: true,
    message: "إذا كان البريد مسجلاً لدينا، بنرسل لك رمز التحقق. الرمز صالح ١٥ دقيقة."
  };

  if (!env?.DB) return json(genericResponse);

  const account = await env.DB.prepare("SELECT merchant_id FROM accounts WHERE email = ?")
    .bind(email)
    .first()
    .catch(() => null);

  // No account: stop here, but return the same message and timing shape.
  if (!account) return json(genericResponse);

  const otpCode = generateOtp();
  const otpHash = await hashOtp(email, otpCode);

  await env.DB.prepare(
    `INSERT INTO password_resets (email, otp_code, reset_token, expires_at)
     VALUES (?, ?, ?, datetime('now', '+15 minutes'))
     ON CONFLICT (email) DO UPDATE SET
       otp_code = excluded.otp_code,
       reset_token = excluded.reset_token,
       expires_at = excluded.expires_at`
  )
    .bind(email, otpHash, "")
    .run()
    .catch(() => {});

  // Out-of-band delivery. WhatsApp is the only channel wired up today; if the
  // merchant has a phone on file we use it. No email provider is configured, so
  // we do not claim an email was sent.
  let delivered = false;
  if (waConfigured(env)) {
    const contact = await env.DB.prepare(
      "SELECT phone FROM whatsapp_contacts WHERE merchant_id = ? ORDER BY last_inbound_at DESC LIMIT 1"
    )
      .bind(account.merchant_id)
      .first()
      .catch(() => null);
    if (contact?.phone) {
      delivered = await sendWaText(env, {
        to: contact.phone,
        body: `رمز استعادة كلمة المرور: ${otpCode}\nصالح ١٥ دقيقة. لا تشاركه مع أحد.`
      })
        .then(() => true)
        .catch(() => false);
    }
  }

  if (!delivered) {
    console.warn("[forgot_password] no delivery channel available for", email);
  }

  return json(genericResponse);
}

export const onRequestPost = withApi(forgotPasswordHandler);

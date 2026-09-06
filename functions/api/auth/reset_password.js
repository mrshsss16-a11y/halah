// POST /api/auth/reset_password — confirm OTP and set a new password.
//
// SECURITY: the OTP is actually verified here (hashed compare, timing-safe,
// expiry-checked, single-use). The previous version accepted any OTP string and
// rewrote the password — a complete account-takeover path.
import { withApi, json } from "../../_lib/core/respond.js";
import { hashPassword } from "../../_lib/core/auth.js";
import { sanitizeInput } from "../../_lib/core/security.js";
import { checkRateLimit } from "../../_lib/core/rateLimit.js";

async function hashOtp(email, otp) {
  const data = new TextEncoder().encode(`${email}:${otp}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function resetPasswordHandler(body, env, request) {
  const clientIp =
    request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "127.0.0.1";
  const rateCheck = await checkRateLimit(env, clientIp, "reset_password", 10, 60);
  if (!rateCheck.allowed) {
    return json({ ok: false, error: `محاولات كثيرة جداً. حاول بعد ${rateCheck.resetInSeconds} ثانية.` }, 429);
  }

  const email = sanitizeInput((body?.email || "").toString().trim().toLowerCase(), 200);
  const otpCode = (body?.otpCode || "").toString().trim();
  const newPassword = (body?.newPassword || "").toString();

  if (!email || !otpCode || !newPassword) {
    return json({ ok: false, error: "يرجى ملء كافة البيانات المطلوبة." }, 400);
  }
  if (newPassword.length < 8) {
    return json({ ok: false, error: "كلمة المرور الجديدة يجب أن تكون 8 خانات على الأقل." }, 400);
  }
  if (!env?.DB) {
    return json({ ok: false, error: "الخدمة غير متاحة حالياً." }, 503);
  }

  // Same message for every failure mode (wrong code, expired, no request on
  // file) so this can't be used to probe which emails have pending resets.
  const invalid = { ok: false, error: "رمز التحقق غير صحيح أو منتهي الصلاحية." };

  const row = await env.DB.prepare(
    "SELECT otp_code FROM password_resets WHERE email = ? AND expires_at > datetime('now')"
  )
    .bind(email)
    .first()
    .catch(() => null);

  if (!row?.otp_code) return json(invalid, 400);

  const providedHash = await hashOtp(email, otpCode);
  if (!timingSafeEqual(providedHash, row.otp_code)) return json(invalid, 400);

  const { hash, salt } = await hashPassword(newPassword);
  // tenant-audit-ok: password reset is keyed by the OTP-verified email — the
  // OTP check above (timingSafeEqual against row.otp_code) is what proves
  // ownership, not a merchant_id condition on this UPDATE.
  const update = await env.DB.prepare(
    "UPDATE accounts SET password_hash = ?, password_salt = ? WHERE email = ?"
  )
    .bind(hash, salt, email)
    .run()
    .catch(() => null);

  if (!update) return json({ ok: false, error: "تعذر تحديث كلمة المرور." }, 500);

  // Single use: burn the OTP so it can't be replayed.
  await env.DB.prepare("DELETE FROM password_resets WHERE email = ?").bind(email).run().catch(() => {});
  // Clear any lockout from failed logins before the reset.
  await env.DB.prepare("DELETE FROM login_attempts WHERE email = ?").bind(email).run().catch(() => {});

  return json({ ok: true, message: "تم تحديث كلمة المرور بنجاح. تقدر تسجل دخولك الآن." });
}

export const onRequestPost = withApi(resetPasswordHandler);

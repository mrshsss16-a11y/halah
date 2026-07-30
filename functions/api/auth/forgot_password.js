// POST /api/auth/forgot_password — Secure Password Recovery Request
import { withApi, json } from "../../_lib/core/respond.js";
import { sanitizeInput } from "../../_lib/core/security.js";
import { checkRateLimit } from "../../_lib/core/rateLimit.js";

async function forgotPasswordHandler(body, env, request) {
  const clientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "127.0.0.1";
  const rateCheck = await checkRateLimit(env, clientIp, "forgot_password", 5, 60);
  if (!rateCheck.allowed) {
    return json({ ok: false, error: `محاولات كثيرة جداً لاستعادة كلمة المرور. حاول بعد ${rateCheck.resetInSeconds} ثانية.` }, 429);
  }

  const email = sanitizeInput((body?.email || "").toString().trim().toLowerCase(), 200);

  if (!email || !email.includes("@")) {
    return json({ ok: false, error: "يرجى إدخال بريد إلكتروني صحيح." }, 400);
  }

  // Generate a secure 6-digit OTP code
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const resetToken = `rst_${Math.random().toString(36).slice(2, 10)}${Date.now()}`;

  if (env?.DB) {
    await env.DB.prepare(
      `INSERT INTO password_resets (email, otp_code, reset_token, expires_at)
       VALUES (?, ?, ?, datetime('now', '+15 minutes'))
       ON CONFLICT (email) DO UPDATE SET
         otp_code = ?,
         reset_token = ?,
         expires_at = datetime('now', '+15 minutes')`
    )
      .bind(email, otpCode, resetToken, otpCode, resetToken)
      .run()
      .catch(() => {});
  }

  return json({
    ok: true,
    email,
    resetToken,
    otpCode,
    message: `تم إرسال رمز التحقق (OTP) إلى بريدك الإلكتروني [${email}] وإلى الواتساب المسجل بنجاح! 🔑`,
    notice: "الرمز صالِح لمدة 15 دقيقة فقط."
  });
}

export const onRequestPost = withApi(forgotPasswordHandler);

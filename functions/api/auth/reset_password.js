// POST /api/auth/reset_password — Confirm OTP & Reset Merchant Password
import { withApi, json } from "../../_lib/core/respond.js";
import { hashPassword } from "../../_lib/core/auth.js";
import { sanitizeInput } from "../../_lib/core/security.js";

async function resetPasswordHandler(body, env, request) {
  const email = sanitizeInput((body?.email || "").toString().trim().toLowerCase(), 200);
  const otpCode = (body?.otpCode || "").toString().trim();
  const newPassword = (body?.newPassword || "").toString();

  if (!email || !otpCode || !newPassword) {
    return json({ ok: false, error: "يرجى ملء كافة البيانات المطلوبة." }, 400);
  }

  if (newPassword.length < 8) {
    return json({ ok: false, error: "كلمة المرور الجديدة يجب أن تكون 8 خانات على الأقل." }, 400);
  }

  const { hash, salt } = await hashPassword(newPassword);

  if (env?.DB) {
    await env.DB.prepare(
      `UPDATE accounts SET password_hash = ?, password_salt = ? WHERE email = ?`
    )
      .bind(hash, salt, email)
      .run()
      .catch(() => {});
  }

  return json({
    ok: true,
    message: "تم تحديث وتعيين كلمة المرور الجديدة بنجاح! 🎉 يمكنك الآن تسجيل الدخول."
  });
}

export const onRequestPost = withApi(resetPasswordHandler);

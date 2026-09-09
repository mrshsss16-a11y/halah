// POST /api/auth/forgot_password — request a password-reset OTP.
//
// SECURITY:
//  - The OTP is NEVER returned in the response (that would be a free takeover).
//  - It is stored hashed, so a DB read alone doesn't grant account access.
//  - The response is identical whether or not the account exists (no user
//    enumeration).
//  - Delivery is out-of-band; when no channel is available we record that fact
//    rather than pretending a message was sent (§١١ الصدق).
import { withApi, json } from "../../_lib/core/respond.js";
import { sanitizeInput } from "../../_lib/core/security.js";
// Q3 — تجزئة الرمز من مصدر واحد (core/auth.js) بدل نسخة بكل ملف.
import { hashOtp } from "../../_lib/core/auth.js";
import { logError } from "../../_lib/core/errorLog.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { findMerchantIdByEmail } from "../../_lib/domain/accounts.js";
import { issuePasswordReset, resetDeliveryPhone } from "../../_lib/domain/auth.js";
import { sendWaText, waConfigured } from "../../_lib/integrations/whatsapp.js";

function generateOtp() {
  // Cryptographically random 6-digit code (Math.random is not acceptable for
  // anything that guards account access).
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + (buf[0] % 900000));
}

async function forgotPasswordHandler(body, env, request) {
  const rl = await checkRateLimit(env, clientIp(request), "forgot_password", 5, 60, { failClosed: true });
  if (!rl.allowed) return json({ ok: false, error: `محاولات كثيرة جداً لاستعادة كلمة المرور. حاول بعد ${rl.resetInSeconds} ثانية.` }, 429);

  const email = sanitizeInput((body?.email || "").toString().trim().toLowerCase(), 200);
  if (!email || !email.includes("@")) return json({ ok: false, error: "يرجى إدخال بريد إلكتروني صحيح." }, 400);

  // Uniform response regardless of account existence (anti-enumeration).
  const genericResponse = {
    ok: true,
    message: "إذا كان البريد مسجلاً لدينا، بنرسل لك رمز التحقق. الرمز صالح ١٥ دقيقة."
  };
  if (!env?.DB) return json(genericResponse);

  const merchantId = await findMerchantIdByEmail(env, email).catch(() => null);
  if (!merchantId) return json(genericResponse);

  const otpCode = generateOtp();
  await issuePasswordReset(env, { email, otpHash: await hashOtp(email, otpCode) });

  // Out-of-band delivery. WhatsApp is the only channel wired up today.
  let delivered = false;
  if (waConfigured(env)) {
    const phone = await resetDeliveryPhone(env, merchantId);
    if (phone) {
      delivered = await sendWaText(env, {
        to: phone,
        body: `رمز استعادة كلمة المرور: ${otpCode}\nصالح ١٥ دقيقة. لا تشاركه مع أحد.`
      })
        .then(() => true)
        .catch(() => false);
    }
  }

  if (!delivered) {
    // N8 — التسجيل المهيكل يوثّق غياب قناة التسليم بلا ذكر أي بريد أو رمز (PII).
    logError({ env }, {
      requestId: null,
      path: "/api/auth/forgot_password",
      code: "RESET_OTP_NOT_DELIVERED",
      internal: "no delivery channel available for a reset request"
    });
  }

  return json(genericResponse);
}

export const onRequestPost = withApi(forgotPasswordHandler);

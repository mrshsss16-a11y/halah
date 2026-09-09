// POST /api/auth/send_verification — يرسل رمز تحقق ملكية البريد لحساب الجلسة الحالية.
//
// P38 طبقة ٢ / P41 (docs/COMPLETION_PATH.md 3.3): حسابات كلمة المرور تُنشأ بلا إثبات أن
// البريد يخص من سجّل. هذا التدفق يثبته: رمز ٦ أرقام مخزّن مُجزّأً، صالح ١٥ دقيقة،
// ٥ محاولات ثم يُحرق — نفس نمط استعادة كلمة المرور (P39).
//
// الصدق: لا مزوّد بريد مضبوط = نرد "غير مفعّل" (503) — لا ندّعي إرسالاً لم يحدث.
import { withApi, json } from "../../_lib/core/respond.js";
import { getSessionMerchantId } from "../../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { accountVerificationState, createEmailVerification, hashVerificationCode,
         verificationChannelReady, deliverVerificationCode } from "../../_lib/domain/auth.js";
import { logError } from "../../_lib/core/errorLog.js";

function generateCode() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + (buf[0] % 900000));
}

async function sendVerificationHandler(body, env, request, requestId, context) {
  const rl = await checkRateLimit(env, clientIp(request), "send_verification", 3, 600, { failClosed: true });
  if (!rl.allowed) {
    return json({ ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" }, 429);
  }

  const merchantId = await getSessionMerchantId(request, env);
  if (!merchantId) return json({ ok: false, error: "سجّل دخولك أولاً.", code: "LOGIN_REQUIRED" }, 401);
  if (!env?.DB) return json({ ok: false, error: "الخدمة غير متاحة حالياً.", code: "DB_UNAVAILABLE" }, 503);

  const account = await accountVerificationState(env, merchantId);
  if (!account?.email) return json({ ok: false, error: "أكمل تسجيل حسابك أولاً.", code: "ACCOUNT_REQUIRED" }, 403);
  if (account.email_verified_at) return json({ ok: true, alreadyVerified: true, message: "بريدك متحقَّق منه مسبقاً." });

  if (!verificationChannelReady(env)) {
    return json({ ok: false, error: "تحقق البريد غير مفعّل حالياً.", code: "EMAIL_NOT_CONFIGURED" }, 503);
  }

  const code = generateCode();
  await createEmailVerification(env, { email: account.email, codeHash: await hashVerificationCode(account.email, code) });

  try {
    await deliverVerificationCode(env, { email: account.email, code });
  } catch (err) {
    logError(context, { requestId, path: "auth/send_verification", code: "EMAIL_SEND_FAILED", storeId: merchantId, internal: String(err?.message || err).slice(0, 250) });
    return json({ ok: false, error: "تعذّر إرسال رمز التحقق حالياً. حاول بعد قليل.", code: "EMAIL_SEND_FAILED" }, 502);
  }

  return json({ ok: true, message: "أرسلنا رمز التحقق لبريدك. صالح ١٥ دقيقة." });
}

export const onRequestPost = withApi(sendVerificationHandler);

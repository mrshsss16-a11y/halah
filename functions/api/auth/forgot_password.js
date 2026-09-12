// POST /api/auth/forgot_password — body: { email } — يرسل رابط استعادة بالبريد.
//
// الأمن: الرد موحّد سواء كان البريد مسجلاً أم لا (لا تعداد)، والإرسال يجري بعد الرد
// (waitUntil) فزمن الاستجابة لا يكشف وجود الحساب. حد معدل لكل IP ولكل بريد.
// الصدق: غياب مزوّد البريد = 503 صريحة للجميع، لا ادعاء إرسال (§١١).
import { withApi, json } from "../../_lib/core/respond.js";
import { sanitizeInput, EMAIL_RE } from "../../_lib/core/security.js";
import { logError } from "../../_lib/core/errorLog.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { findMerchantIdByEmail } from "../../_lib/domain/accounts.js";
import {
  emailResetReady, generateResetToken, hashResetToken, storeResetToken,
  sendResetEmail, resetEmailRateKey, RESET_TTL_MINUTES
} from "../../_lib/domain/passwordReset.js";

const PATH = "/api/auth/forgot_password";
const tooMany = (s) => json({ ok: false, error: `محاولات كثيرة جداً لاستعادة كلمة المرور. حاول بعد ${s} ثانية.`, code: "RATE_LIMITED" }, 429);

async function forgotPasswordHandler(body, env, request, requestId, context) {
  const rl = await checkRateLimit(env, clientIp(request), "forgot_password", 5, 60, { failClosed: true });
  if (!rl.allowed) return tooMany(rl.resetInSeconds);

  const email = sanitizeInput((body?.email || "").toString().trim().toLowerCase(), 200);
  if (!email || !EMAIL_RE.test(email)) return json({ ok: false, error: "يرجى إدخال بريد إلكتروني صحيح." }, 400);

  if (!emailResetReady(env) || !env?.DB) {
    logError(context, { requestId, path: PATH, code: "RESET_EMAIL_NOT_CONFIGURED", internal: "RESEND_API_KEY/EMAIL_FROM or DB missing — reset refused" });
    return json({ ok: false, error: "استعادة كلمة المرور بالبريد غير مفعّلة حالياً. راسلنا على aurateam3@gmail.com ونساعدك.", code: "EMAIL_NOT_CONFIGURED" }, 503);
  }

  // لكل بريد: ٣ روابط بالساعة — يمنع إغراق صندوق شخص ما، ويُطبَّق قبل البحث عن الحساب.
  const perEmail = await checkRateLimit(env, await resetEmailRateKey(email), "forgot_password_email", 3, 3600, { failClosed: true });
  if (!perEmail.allowed) return tooMany(perEmail.resetInSeconds);

  const generic = {
    ok: true,
    message: `إن كان هذا البريد مسجّلاً لدينا فقد أرسلنا إليه رابط استعادة صالحاً ${RESET_TTL_MINUTES} دقيقة. لم يصلك خلال دقائق؟ راجع الرسائل غير المرغوب فيها أو اطلب رابطاً جديداً.`
  };

  const work = (async () => {
    const merchantId = await findMerchantIdByEmail(env, email);
    if (!merchantId) return;
    const token = generateResetToken();
    await storeResetToken(env, { email, tokenHash: await hashResetToken(token) });
    await sendResetEmail(env, { email, token });
  })().catch((err) => {
    // بلا بريد ولا توكن بالسجل (N8).
    logError(context, { requestId, path: PATH, code: "RESET_EMAIL_SEND_FAILED", internal: String(err?.message || err).slice(0, 250) });
  });

  if (typeof context?.waitUntil === "function") context.waitUntil(work);
  else await work;
  return json(generic);
}

export const onRequestPost = withApi(forgotPasswordHandler);

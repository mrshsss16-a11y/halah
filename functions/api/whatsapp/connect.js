// POST /api/whatsapp/connect — body: { code, wabaId, phoneNumberId }
//
// تنسيق فقط (ARCHITECTURE §١، المرحلة ٤): هوية ← حد معدل ← تحقق مدخل ←
// `domain/whatsappConnect` ← json. تبادل التوكن والاشتراك بالويبهوك والحفظ
// كلها بـ`_lib/domain/whatsappConnect.js`.
//
// STATUS: موصول من الطرفين لكنه **خامل عمداً** بالإنتاج حتى تعتمد ميتا التطبيق
// كـTech Provider ويُضبط `WA_SIGNUP_CONFIG_ID` — عندها يعمل بلا تعديل كود.
import { withApi, json } from "../../_lib/core/respond.js";
import { requireCompletedAccount } from "../../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { connectWhatsappNumber, assertPhoneNotTaken, metaAppSecret } from "../../_lib/domain/whatsappConnect.js";

async function connectHandler(body, env, request, requestId, context) {
  // تاجر مسجَّل بحساب مكتمل فقط: ربط قناة خارجية "عملية حقيقية"، وجلسة سلة بلا
  // صف `accounts` تأخذ 403 ACCOUNT_REQUIRED (انظر requireCompletedAccount).
  const merchantId = await requireCompletedAccount(request, env, body?.storeId);

  const rate = await checkRateLimit(env, clientIp(request), "wa_connect", 5, 300);
  if (!rate.allowed) {
    return json({ ok: false, error: `محاولات كثيرة. حاول بعد ${rate.resetInSeconds} ثانية.` }, 429);
  }

  // Fail closed: بلا سرّ التطبيق لا يمكن تبادل الكود أصلاً، ولا يجوز الارتداد
  // لأي بيانات اعتماد مشتركة أو افتراضية.
  if (!env.META_APP_ID || !metaAppSecret(env)) {
    return json({ ok: false, error: "ربط واتساب غير مفعّل حالياً.", code: "NOT_CONFIGURED" }, 503);
  }

  const code = (body?.code || "").toString();
  const wabaId = (body?.wabaId || "").toString().replace(/[^\d]/g, "");
  const phoneNumberId = (body?.phoneNumberId || "").toString().replace(/[^\d]/g, "");

  if (!code || !wabaId || !phoneNumberId) {
    return json({ ok: false, error: "بيانات الربط ناقصة." }, 400);
  }

  if (!(await assertPhoneNotTaken(env, phoneNumberId, merchantId))) {
    return json({ ok: false, error: "هذا الرقم مربوط بحساب آخر.", code: "NUMBER_TAKEN" }, 409);
  }

  const details = await connectWhatsappNumber(env, { merchantId, code, wabaId, phoneNumberId, context, requestId });

  // Never return the token to the browser.
  return json({ ok: true, ...details });
}

export const onRequestPost = withApi(connectHandler);

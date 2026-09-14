// إيقاف استخدام هالة بعد انتهاء تجربة/اشتراك سلة — مع **بقاء** الحساب والتوكنات (2026-09-15).
//
// كان `app.trial.expired`/`app.subscription.expired` يحذف توكنات سلة. توثيق سلة: `app.subscription.renewed`
// و`started` يحملان معرّف الاشتراك فقط، لا توكنات جديدة — فالتاجر الذي يجدّد يجد هالة معطّلة حتى يعيد التثبيت.
// الآن: علم إيقاف يُرفع ببدء/تجديد الاشتراك أو التجربة أو إعادة التثبيت. الحذف الفعلي للتوكنات عند إزالة التطبيق فقط.
//
// KV لا D1: بلا هجرة أثناء مراجعة سلة. المفتاح بلا انتهاء.
const key = (merchantId) => `access_expired:${merchantId}`;

export async function markAccessExpired(env, merchantId, reason) {
  if (!env?.HALA_CACHE || !merchantId) return;
  await env.HALA_CACHE.put(key(merchantId), JSON.stringify({ reason: String(reason || "").slice(0, 60), at: new Date().toISOString() }));
}

export async function clearAccessExpired(env, merchantId) {
  if (!env?.HALA_CACHE || !merchantId) return;
  await env.HALA_CACHE.delete(key(merchantId));
}

export async function isAccessExpired(env, merchantId) {
  if (!env?.HALA_CACHE || !merchantId) return false;
  try {
    return Boolean(await env.HALA_CACHE.get(key(merchantId)));
  } catch {
    return false;
  }
}

// إيقاف استخدام هالة بعد انتهاء تجربة/اشتراك سلة — مع **بقاء** الحساب والتوكنات (2026-09-15).
//
// كان `app.trial.expired`/`app.subscription.expired` يحذف توكنات سلة. توثيق سلة: `app.subscription.renewed`
// و`started` يحملان معرّف الاشتراك فقط، لا توكنات جديدة — فالتاجر الذي يجدّد يجد هالة معطّلة حتى يعيد التثبيت.
// الآن: علم إيقاف يُرفع ببدء/تجديد الاشتراك أو التجربة أو إعادة التثبيت. الحذف الفعلي للتوكنات عند إزالة التطبيق فقط.
//
// KV لا D1: بلا هجرة أثناء مراجعة سلة. المفتاح بلا انتهاء.
const key = (merchantId) => `access_expired:${merchantId}`;

// 2026-09-17: WP-A8 — كل .put على HALA_CACHE لازم expirationTtl (منع تضخّم KV
// بلا سقف). هذا المفتاح **علم تعليق وصول** لا كاش عادي: لو انتهت صلاحيته قبل
// أن يعيد التاجر التثبيت/يجدّد، تُرفع isAccessExpired صمتاً فيُعامَل تاجر
// موقوف كأنه نشط. لذلك ٤٠٠ يوم (أطول من أي دورة تجديد سنوية متوقَّعة + هامش)
// بدل أيام قليلة — لا نضحّي بصحة العلم الأمني من أجل توحيد الأرقام مع بقية
// المفاتيح. طول العمر أصلاً غير حساس هنا لأن clearAccessExpired يحذفه صراحة
// عند إعادة التثبيت/التجديد الفعلي.
const ACCESS_EXPIRED_TTL_SECONDS = 400 * 24 * 3600;

export async function markAccessExpired(env, merchantId, reason) {
  if (!env?.HALA_CACHE || !merchantId) return;
  await env.HALA_CACHE.put(
    key(merchantId),
    JSON.stringify({ reason: String(reason || "").slice(0, 60), at: new Date().toISOString() }),
    { expirationTtl: ACCESS_EXPIRED_TTL_SECONDS }
  );
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

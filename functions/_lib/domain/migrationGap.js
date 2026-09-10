// تحمّل فجوة الهجرة — عمود جديد لا يُسقط ميزة قائمة.
//
// النشر والهجرة خطوتان منفصلتان بطبيعتهما: `npm run deploy` يرفع الكود، وهجرة
// D1 تُطبَّق بأمر منفصل من المالك. رُصد 2026-09-10: نُشر كود يقرأ ويكتب عمود
// `variants` قبل تطبيق هجرة 0027، فسقط **كل** استعلام كتالوج برسالة عامة —
// «تعذّر الوصول لبياناتك» — والتاجر يظن التطبيق معطّلاً وهو سليم.
//
// أول فشل بسبب عمود مفقود يُسقطه من الاستعلام لبقية عمر الـWorker ويُعاد
// النداء. العلم بالذاكرة لا بالقاعدة، فيُعاد ضبطه تلقائياً بأول نشر بعد تطبيق
// الهجرة — بلا تدخّل يدوي ولا علم دائم يُنسى.
let variantsColumnMissing = false;

function isMissingVariantsColumn(err) {
  return /no such column.*variants/is.test(String(err?.message || err));
}

/** ينفّذ استعلاماً بـ`variants`، ويعيده بدونه إن لم تُطبَّق الهجرة بعد. */
export async function withVariantsFallback(run) {
  if (variantsColumnMissing) return run(false);
  try {
    return await run(true);
  } catch (err) {
    if (!isMissingVariantsColumn(err)) throw err;
    variantsColumnMissing = true;
    return run(false);
  }
}

/** جزء العمود بالاستعلام — فارغ حين تكون الهجرة غير مطبَّقة. */
export const VCOL = (on) => (on ? ", variants" : "");

/** للاختبار فقط: يعيد الحالة لبدايتها بين الحالات. */
export function __resetVariantsFallback() {
  variantsColumnMissing = false;
}

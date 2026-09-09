// حدود الترقيم (pagination) — مصدر واحد (docs/ARCHITECTURE.md §١، المرحلة ١).
//
// لماذا ملف مستقل: نفس الثابتين `MAX_LIMIT`/`DEFAULT_LIMIT` ونفس تعبير القص
// `Math.min(Math.max(Number(x) || D, 1), M)` كانا مكرَّرين حرفياً بـ`services/catalog.js`
// و`services/reviewQueue.js` (٥ مواضع) بقيم مختلفة صامتة. التكرار هنا ليس قبحاً
// تجميلياً: كل نسخة تنحرف وحدها، وأي تشديد لحدّ (مثلاً بعد حادثة استهلاك) يُطبَّق
// على واحدة وتُنسى الأخرى — فيبقى المسار الأوسع مفتوحاً بلا أن يلاحظ أحد.
//
// `core/` بنية تحتية فقط: هذا الملف ثوابت + دالة نقية، صفر SQL وصفر منطق أعمال.

/** كتالوج المنتجات — `services/catalog.js:listCatalog`. */
export const CATALOG_LIST_LIMITS = { max: 100, default: 50 };

/** طابور المراجعة البشرية — `services/reviewQueue.js` (listPending · listByState · listApprovedUnpublished). */
export const REVIEW_LIST_LIMITS = { max: 100, default: 25 };

/**
 * يقصّ حدّ صفحة قادماً من العميل داخل [1, max]، ويعيد `default` لأي مدخل غير رقمي.
 * `Number(raw) || fallback` مقصود: 0 و NaN و "" و null كلها تعني «لم يُحدَّد».
 *
 * @param {unknown} raw قيمة العميل كما وصلت (نص أو رقم أو غياب)
 * @param {{max:number, default:number}} bounds أحد الثوابت أعلاه
 * @returns {number} عدد صحيح ضمن المدى
 */
export function clampLimit(raw, bounds) {
  const fallback = bounds.default;
  return Math.min(bounds.max, Math.max(1, Math.floor(Number(raw) || fallback)));
}

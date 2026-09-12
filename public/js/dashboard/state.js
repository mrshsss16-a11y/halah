// public/js/dashboard/state.js — الحالة المشتركة للوحة التاجر كوحدة واحدة.
//
// لماذا كائن واحد وليس متغيّرات مصدَّرة: روابط ES modules للقراءة فقط عند
// المستورِد — `import { lastCopy }` لا يمكن إسنادها من ملف آخر. كل ما كان
// متغيّراً عاماً بـdashboard.html صار حقلاً هنا، فتبقى القراءة والكتابة عبر
// الوحدات مطابقة تماماً لسلوك النطاق العام السابق.
//
// كلها ذاكرة صفحة فقط — لا تخزين محلي ولا كوكيز (جهاز مشترك = تسريب هوية).
export const S = {
  // ── الاستوديو والنشر ──
  lastCopy: null,
  publishing: false,          // قفل ضغطة النشر المزدوجة
  selectedCatalogProduct: null, // { productId, name } أو null

  // null = لم تُجلب حالة المتجر بعد؛ false = غير مربوط فعلاً (store.js).
  storeLinked: null,

  // ── منتجاتي (كتالوج سلة المسحوب) ──
  catalogItems: {},
  // خيارات المنتج المختار (JSON من سلة) — تُمرَّر للتوليد كبيانات مؤكَّدة.
  selectedVariants: null,
  catalogNextOffset: 0,
  catalogLoadedOnce: false,
  lastCatalogTotal: 0,
  catalogRefreshTimer: null,
  syncCooldownTimer: null,
  /** حالة الاختيار المتعدد — تبقى بالذاكرة فقط، تُمسح بكل تحميل صفحة. */
  selectedSkus: new Set(),

  // ── التوليد بالجملة ──
  bulkPollTimer: null,

  // ── طابور المراجعة ──
  reviewState: "pending",
  reviewLoadedOnce: false,
  reviewRows: [],

  // ── التغذية الراجعة ──
  feedbackScore: 0,

  // ── ربط واتساب (Embedded Signup) ──
  // معرّف الإعداد يجي من الخادم لا مكتوباً هنا: لا يوجد إلا بعد اعتماد ميتا.
  waSignupConfigId: null,
  waMetaAppId: null,
  waSignupSession: null
};

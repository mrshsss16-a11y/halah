// تعقيم حقول التحرير اليدوي بشاشة المراجعة (بند "مراجعة كل حقل" — طلب المالك 2026-09-14).
//
// دالة نقية بلا I/O: تأخذ body.fields (أو الشكل القديم {description}) وترجع
// {patch, errors} — patch يُدمَج فوق الحمولة بنفس مسارات النشر (publish.js/
// sallaProductPayload.js يقرآن copywriting.excerpt/highlights، faqs،
// specsTable، seo.*). مفاتيح غير معروفة تُتجاهل بصمت، لا تُرفض الطلب كله.
//
// لماذا هنا لا بـapi/**: حد ٨٠ سطراً على functions/api (docs/ARCHITECTURE §٤)
// يمنع منطق التعقيم من العيش بالـendpoint؛ ودالة نقية تُختبر بلا D1 وهمي.

const LIMITS = {
  description: 5000,
  excerpt: 250,
  highlightItem: 200,
  highlightsMax: 8,
  faqQ: 200,
  faqA: 600,
  faqsMax: 8,
  specKey: 60,
  specValue: 200,
  specsMax: 15,
  seoTitle: 70,
  metaDescription: 160
};

const EXCLUDABLE = ["excerpt", "highlights", "faqs", "specsTable", "seo"];

/** يشيل وسوم HTML (< و>) ويقص الفراغات الزائدة — نص خام فقط يصل سلة. */
function stripHtml(v) {
  return String(v ?? "").replace(/<[^>]*>/g, "").replace(/[<>]/g, "").trim();
}

function cleanStr(v, max) {
  const s = stripHtml(v).slice(0, max);
  return s;
}

function sanitizeHighlights(arr) {
  if (!Array.isArray(arr)) return undefined;
  const out = arr.map((h) => cleanStr(h, LIMITS.highlightItem)).filter(Boolean).slice(0, LIMITS.highlightsMax);
  return out;
}

function sanitizeFaqs(arr) {
  if (!Array.isArray(arr)) return undefined;
  const out = arr
    .map((f) => ({ q: cleanStr(f?.q, LIMITS.faqQ), a: cleanStr(f?.a, LIMITS.faqA) }))
    .filter((f) => f.q && f.a)
    .slice(0, LIMITS.faqsMax);
  return out;
}

function sanitizeSpecsTable(arr) {
  if (!Array.isArray(arr)) return undefined;
  const out = arr
    .map((r) => ({ key: cleanStr(r?.key, LIMITS.specKey), value: cleanStr(r?.value, LIMITS.specValue) }))
    .filter((r) => r.key && r.value)
    .slice(0, LIMITS.specsMax);
  return out;
}

function sanitizeSeo(obj) {
  if (!obj || typeof obj !== "object") return undefined;
  const out = {};
  if (obj.title !== undefined) out.title = cleanStr(obj.title, LIMITS.seoTitle);
  if (obj.seoTitle !== undefined) out.seoTitle = cleanStr(obj.seoTitle, LIMITS.seoTitle);
  if (obj.metaDescription !== undefined) out.metaDescription = cleanStr(obj.metaDescription, LIMITS.metaDescription);
  return out;
}

function sanitizeExclude(obj, base) {
  if (!obj || typeof obj !== "object") return undefined;
  const out = { ...base };
  for (const k of EXCLUDABLE) {
    if (typeof obj[k] === "boolean") out[k] = obj[k];
  }
  return out;
}

/**
 * fields → patch جاهز للدمج بـupdatePayload({patch}). `currentPayload` (كائن
 * الحمولة الحالي، اختياري) يُستخدم لدمج copywriting/seo/exclude الجزئي بدل
 * الكتابة فوقهم بالكامل.
 *
 * التوافق الخلفي: body.description مباشرة (الشكل القديم) يُقرأ أيضاً لو مرّ
 * كـ`fields` أو بمفرده — المستدعي يمرر `{ description, ...fields }` بحرية.
 */
export function sanitizeReviewFields(fields, currentPayload = {}) {
  const f = fields && typeof fields === "object" && !Array.isArray(fields) ? fields : {};
  const patch = {};

  if (f.description !== undefined) {
    const description = cleanStr(f.description, LIMITS.description);
    if (description) patch.description = description;
  }

  const copywriting = { ...(currentPayload?.copywriting || {}) };
  let touchedCopywriting = false;

  if (f.excerpt !== undefined) {
    copywriting.excerpt = cleanStr(f.excerpt, LIMITS.excerpt);
    // publish.js يقرأ `copywriting.excerpt || excerpt`: نبذة أفرغها التاجر ("") كانت ترجع من الحقل العلوي القديم.
    patch.excerpt = copywriting.excerpt;
    touchedCopywriting = true;
  }
  const highlights = sanitizeHighlights(f.highlights);
  if (highlights !== undefined) {
    copywriting.highlights = highlights;
    touchedCopywriting = true;
  }
  if (touchedCopywriting) patch.copywriting = copywriting;

  const faqs = sanitizeFaqs(f.faqs);
  if (faqs !== undefined) patch.faqs = faqs;

  const specsTable = sanitizeSpecsTable(f.specsTable);
  if (specsTable !== undefined) patch.specsTable = specsTable;

  const seo = sanitizeSeo(f.seo);
  if (seo !== undefined) patch.seo = { ...(currentPayload?.seo || {}), ...seo };

  const exclude = sanitizeExclude(f.exclude, currentPayload?.exclude || {});
  if (exclude !== undefined) patch.exclude = exclude;

  return patch;
}

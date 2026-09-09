// المكان الوحيد الذي يحوّل مخرج هالة (وصف + سيو) إلى حقول منتج سلة.
//
// أسماء الحقول من توثيق سلة الرسمي "Update Product By SKU" (docs.salla.dev/5394174e0،
// تحقق 2026-09-08): حقول السيو **من المستوى الأعلى** لا كائن متداخل —
//   metadata_title · metadata_description · metadata_url · subtitle · description (يقبل HTML)
// الشكل السابق `metadata: { title, description }` كان خاطئاً (لا يطابق التوثيق).
//
// قرارات مقصودة:
// - metadata_url **لا يُرسل أبداً**: تغيير رابط منتج مفهرس يكسر روابطه بمحركات البحث
//   ويُسقط ترتيبه — ضرر سيو مباشر أكبر من أي فائدة لسلاج "أجمل".
// - الوصف يُنشر HTML منظّماً (فقرات + نقاط + أسئلة شائعة) لأن صفحة المنتج بسلة
//   ترندره؛ كل النص من مخرج المراجعة المعتمد فقط — صفر نص مضاف من عندنا.
// - subtitle = أول جملة من النبذة بحد ١٢٠ حرفاً (يظهر تحت الاسم).
// - كل نص يُهرَّب قبل الإدراج بالـHTML: النموذج ومدخلات التاجر ليست موثوقة كـHTML.

const MAX_DESCRIPTION_CHARS = 20000;
const MAX_META_TITLE = 65;
const MAX_META_DESC = 160;
const MAX_SUBTITLE = 120;

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function clean(v, max) {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : "";
}

function firstSentence(text, max) {
  const s = clean(text, 1000);
  if (!s) return "";
  const m = s.match(/^(.+?[.!؟?…])(\s|$)/);
  return clean(m ? m[1] : s, max);
}

/**
 * يبني HTML الوصف من الحقول المعتمَدة. الفقرات من الوصف (كل سطر فارغ = فقرة)،
 * ثم النقاط، ثم الأسئلة الشائعة — كل قسم يظهر فقط إن كان له محتوى فعلي.
 */
export function composeDescriptionHtml({ description, highlights = [], faqs = [] } = {}) {
  const paragraphs = String(description ?? "")
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!paragraphs.length) return "";

  const parts = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`);

  const bullets = (Array.isArray(highlights) ? highlights : []).map((h) => clean(h, 200)).filter(Boolean);
  if (bullets.length) parts.push(`<ul>${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`);

  const qa = (Array.isArray(faqs) ? faqs : [])
    .map((f) => ({ q: clean(f?.q, 200), a: clean(f?.a, 600) }))
    .filter((f) => f.q && f.a);
  if (qa.length) {
    parts.push(qa.map((f) => `<h3>${escapeHtml(f.q)}</h3><p>${escapeHtml(f.a)}</p>`).join(""));
  }

  return parts.join("").slice(0, MAX_DESCRIPTION_CHARS);
}

/**
 * الحقول الجاهزة لـ PUT /products/sku/{sku} (أو /products/{id}).
 * يعيد أيضاً `descriptionOnly` — الحمولة الاحتياطية لو رفضت سلة حقول السيو (٤٢٢).
 */
export function buildSallaProductFields({ description, excerpt, highlights, faqs, seo } = {}) {
  const html = composeDescriptionHtml({ description, highlights, faqs });
  if (!html) throw new Error("الوصف فارغ — لا شيء يُنشر.");

  const fields = { description: html };
  const subtitle = firstSentence(excerpt, MAX_SUBTITLE);
  if (subtitle) fields.subtitle = subtitle;
  const metaTitle = clean(seo?.seoTitle || seo?.title, MAX_META_TITLE);
  if (metaTitle) fields.metadata_title = metaTitle;
  const metaDesc = clean(seo?.metaDescription, MAX_META_DESC);
  if (metaDesc) fields.metadata_description = metaDesc;

  return { fields, descriptionOnly: { description: html }, hasSeo: Boolean(metaTitle || metaDesc || subtitle) };
}

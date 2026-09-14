// عرض صف review_queue للتاجر — مستخرَج من api/store/review/list.js حتى
// يستخدمه أيضاً api/store/review/decide.js (رد `update` يعيد نفس شكل toView
// بلا استيراد كود endpoint من endpoint آخر). صفر تغيير سلوكي عن list.js الأصلي.
function parsePayload(raw) {
  try {
    const p = JSON.parse(raw);
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

const EXCLUDABLE = ["excerpt", "highlights", "faqs", "specsTable", "seo"];

export function toReviewView(row) {
  const p = parsePayload(row.payload) || {};
  const exclude = {};
  for (const k of EXCLUDABLE) exclude[k] = Boolean(p.exclude?.[k]);
  return {
    id: row.id,
    status: row.status,
    sku: p.sku || null,
    name: p.name || null,
    price: p.price || null,
    category: p.category || null,
    imageUrl: p.imageUrl || null,
    currentDescription: p.currentDescription || null,
    description: p.description || null,
    excerpt: p.copywriting?.excerpt || null,
    highlights: Array.isArray(p.copywriting?.highlights) ? p.copywriting.highlights.slice(0, 8) : [],
    faqs: Array.isArray(p.faqs) ? p.faqs.slice(0, 8) : [],
    specsTable: Array.isArray(p.specsTable) ? p.specsTable.slice(0, 15) : [],
    seo: p.seo ? { title: p.seo.title || null, seoTitle: p.seo.seoTitle || null, metaDescription: p.seo.metaDescription || null, focusKeyword: p.seo.focusKeyword || null } : null,
    exclude,
    editedAt: p.editedAt || null,
    reviewedAt: row.reviewed_at || null,
    publishedAt: row.published_at || null,
    publishError: row.publish_error || null,
    reviewNote: row.review_note || null,
    createdAt: row.created_at || null
  };
}

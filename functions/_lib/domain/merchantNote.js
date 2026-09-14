// «وش يميز منتجك؟» — سطر اختياري يكتبه التاجر قبل تحليل الصورة (طلب المالك 2026-09-14).
// نص تاجر غير موثوق يدخل الموجّه: يُسطَّح لسطر واحد (لا أسطر ولا أقواس قد تُقرأ تعليمات أو JSON)
// ويُقصّ. الحراس اللاحقة (الادعاءات، الجنس، الأرقام) تبقى سارية عليه كأي مصدر آخر.
const NOTE_MAX = 300;
const NOTE_TTL_SECONDS = 120 * 24 * 60 * 60; // يعيش ما دامت الصفوف المؤجَّلة تُحيا يوماً بيوم

export function cleanMerchantNote(value, max = NOTE_MAX) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f<>`{}\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** { sku: نص } من العميل ← Map نظيف للـSKU المسموحة فقط، والفارغ يسقط. */
export function cleanNotesBySku(raw, allowedSkus) {
  const out = new Map();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const allowed = new Set(allowedSkus);
  for (const [sku, value] of Object.entries(raw).slice(0, 500)) {
    const note = cleanMerchantNote(value);
    if (note && allowed.has(sku)) out.set(sku, note);
  }
  return out;
}

const noteKey = (jobId, sku) => `bulknote:${jobId}:${sku}`;

export async function saveJobNotes(env, jobId, notes) {
  if (!env.HALA_CACHE || !notes.size) return;
  await Promise.all([...notes].map(([sku, note]) =>
    env.HALA_CACHE.put(noteKey(jobId, sku), note, { expirationTtl: NOTE_TTL_SECONDS }).catch(() => {})));
}

export async function readJobNote(env, jobId, sku) {
  if (!env.HALA_CACHE) return "";
  try {
    return cleanMerchantNote(await env.HALA_CACHE.get(noteKey(jobId, sku)));
  } catch {
    return "";
  }
}

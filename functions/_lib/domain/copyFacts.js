// حفظ حقائق التاجر في الحقول المنشورة — معيار هالة C1 (docs/COPY_STANDARD.md §٧.٤)، 2026-09-13.
// المعايرة بحَكَمين: فستان شادن فقد الخامة والقياسات، وساعة سيكو «ستانلس ستيل»، وفستان السهرة مقاساته XS–XXXL.
// كل حقيقة قابلة للقياس في بيانات التاجر (رقم بوحدة، خامة، منشأ، خيارات) ولم تظهر بأي حقل يراه العميل تُضاف صفاً
// لجدول المواصفات المنشور بكلمات التاجر نفسها — لا اختراع ولا إعادة صياغة. اسم المنتج ظاهر للعميل فحقائقه محفوظة.

const UNIT_GROUPS = [
  { key: "الوزن", units: ["كيلوغرام", "كيلوجرام", "كيلو", "كجم", "كغ", "غرام", "جرام", "جم", "غم", "kg"] },
  { key: "الحجم", units: ["مليلتر", "ملليلتر", "مللي", "مل", "لتر", "تولة", "تولات", "ml", "oz"] },
  { key: "المقاس", units: ["سنتيمتر", "سم", "ملم", "مم", "متر", "إنش", "انش", "cm", "mm", "inch"] },
  { key: "القدرة", units: ["واط", "w"] },
  { key: "سعة البطارية", units: ["مللي أمبير", "mah"] },
  { key: "الجهد", units: ["فولت"] },
  { key: "المدة", units: ["سنوات", "سنتين", "سنة", "أشهر", "اشهر", "شهور", "شهر", "ساعات", "ساعة", "يوم", "أيام", "ايام"] },
  { key: "الكمية", units: ["قطع", "قطعة", "حبة", "حبات", "كبسولة", "كبسولات", "ظرف", "أظرف", "كيس", "أكياس"] },
  { key: "النسبة", units: ["%"] }
];
const MATERIALS = ["قطن", "بوليستر", "حرير", "كريب", "شيفون", "ساتان", "ستان", "جلد", "ستانلس", "فولاذ", "ذهب", "فضة", "زركون", "خشب", "زجاج", "سيراميك", "بلاستيك", "ألمنيوم", "المنيوم", "صوف", "كتان", "نايلون", "مخمل", "دانتيل", "ليكرا", "فيسكوز", "نحاس", "بورسلين"];
const ORIGIN = /(?<!\p{L})(?:صنع[ \t]+في|صُنع[ \t]+في|المنشأ|منشأ|بلد[ \t]+المنشأ)(?!\p{L})/u;
const MAX_ROWS = 8;

const norm = (t) => String(t || "")
  .replace(/<[^>]+>/g, " ")
  .replace(/[\u064B-\u0652\u0640]/g, "")
  .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
  .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
  .replace(/[\s\u00A0]+/g, " ")
  .toLowerCase().trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ذرّات الحقيقة في مقطع: رقم بوحدته، أو خامة، أو منشأ. */
function atoms(clause) {
  const n = norm(clause);
  const found = [];
  for (const g of UNIT_GROUPS) {
    const alt = g.units.map((u) => esc(norm(u))).join("|");
    const re = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:${alt})(?![\\p{L}])`, "gu");
    for (const m of n.matchAll(re)) found.push({ kind: "unit", key: g.key, num: m[1], alt });
  }
  const karat = n.match(/عيار\s*(\d{2})/u);
  if (karat) found.push({ kind: "karat", key: "العيار", num: karat[1] });
  for (const w of MATERIALS) if (new RegExp(`(?<!\\p{L})(?:و|ب|من\\s)?(?:ال)?${esc(norm(w))}(?!\\p{L})`, "u").test(n)) found.push({ kind: "material", key: "الخامة", word: norm(w) });
  if (ORIGIN.test(clause)) found.push({ kind: "origin", key: "المنشأ", phrase: n });
  return found;
}

function present(atom, visible) {
  if (atom.kind === "unit") return new RegExp(`(?<![\\d.,])${esc(atom.num)}\\s*(?:${atom.alt})(?![\\p{L}])`, "u").test(visible);
  if (atom.kind === "karat") return new RegExp(`عيار\\s*${atom.num}`, "u").test(visible);
  if (atom.kind === "material") return new RegExp(`(?<!\\p{L})(?:و|ب)?(?:ال)?${esc(atom.word)}`, "u").test(visible);
  // المنشأ: يكفي ظهور آخر كلمة في المقطع (اسم البلد عادةً).
  const last = atom.phrase.split(" ").filter((w) => w.length > 2).pop() || "";
  return last ? visible.includes(last) : true;
}

function clausesOf(text) {
  return String(text || "")
    .replace(/<\/(?:p|li|h\d|div|br)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split(/[\n؛;•·|]+|،\s+|\.\s+(?=\S)/u)
    .map((c) => c.replace(/\s+/g, " ").replace(/^[\s\-–—*و]+|[\s.،]+$/gu, "").trim())
    .filter((c) => c.length >= 3 && c.length <= 140);
}

function visibleText(parsed, name) {
  const cw = parsed?.copywriting || {};
  return norm([
    name, cw.description, cw.excerpt, ...(cw.highlights || []),
    parsed?.seo?.title, parsed?.seo?.metaDescription,
    ...(parsed?.faqs || []).flatMap((f) => [f?.q, f?.a]),
    ...(parsed?.specsTable || []).flatMap((r) => [r?.key, r?.value])
  ].filter(Boolean).join(" \n "));
}

/**
 * يضيف لجدول المواصفات كل حقيقة قابلة للقياس من بيانات التاجر لم تظهر في أي حقل منشور. يرجع عدد الصفوف المضافة.
 * @param {object} parsed - صفحة المنتج بعد التنظيف
 * @param {{name?: string, features?: string, existingDescription?: string, variants?: Array}} src
 */
export function preserveMerchantFacts(parsed, { name = "", features = "", existingDescription = "", variants = [] } = {}) {
  if (!parsed) return 0;
  const rows = Array.isArray(parsed.specsTable) ? parsed.specsTable : (parsed.specsTable = []);
  let added = 0;
  const seen = new Set();
  for (const clause of [...clausesOf(features), ...clausesOf(existingDescription)]) {
    if (added >= MAX_ROWS) break;
    const list = atoms(clause);
    if (!list.length) continue;
    const visible = visibleText(parsed, name);
    const missing = list.filter((a) => !present(a, visible));
    if (!missing.length) continue;
    const labeled = clause.match(/^([^:：]{2,25})[:：]\s*(.+)$/u);
    const key = labeled && labeled[1].trim().split(/\s+/).length <= 3 ? labeled[1].trim() : missing[0].key;
    const value = (labeled ? labeled[2] : clause).trim();
    const id = norm(value);
    if (!value || seen.has(id)) continue;
    seen.add(id);
    rows.push({ key, value });
    added++;
  }
  for (const v of Array.isArray(variants) ? variants : []) {
    if (added >= MAX_ROWS) break;
    const values = (Array.isArray(v?.values) ? v.values : []).map((x) => String(x).trim()).filter(Boolean);
    if (!v?.name || values.length < 2) continue;
    const visible = visibleText(parsed, name);
    const shown = values.filter((x) => visible.includes(norm(x))).length;
    if (shown * 2 >= values.length) continue;
    rows.push({ key: String(v.name).trim(), value: values.join("، ") });
    added++;
  }
  return added;
}

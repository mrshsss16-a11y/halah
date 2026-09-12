// ذاكرة دروس وكيل وصف المنتجات (طلب المالك 2026-09-12): «المشاكل والتعليمات لا تعدلها فقط بل اجعل
// وكيل وصف المنتجات يتعلم منها بحيث يتجنبها».
//
// الحراس بعد الكتابة تُصلح الخطأ في النص المنشور، لكن النموذج لا يعرف أنه أخطأ فيكرر الخطأ نفسه.
// هنا: بعد كل توليد يُقارَن المسودة الأولى بالنص المنشور وملاحظات الصورة الخام بالمنقّاة، وكل ما
// أصلحته الحراس يُسجَّل درساً (رمز + الخطأ + الصواب). قبل كل توليد تُحقن أكثر الدروس تكراراً
// بتوجيه الكاتب والكاتب المركّز وقارئ الصورة.
//
// الجدول عام بلا merchant_id عمداً: يحفظ رمز الخطأ وكلمة من معجم الحراس أو كلمة لاتينية قصيرة
// كتبها النموذج — لا نص تاجر ولا اسم منتج — فالدرس من متجر ينفع كل المتاجر ولا يكشف بيانات أحد.
import { fixLatinWords, SALES_CTA, findColorAgreement } from "./copyPhrases.js";

const MAX_LESSONS_PER_PROMPT = 8;
const JUDGMENT_WORDS = /(?<!\p{L})(?:و|ب|ل)?(?:ال)?((?:[أا]نيق|فاخر|مريح|مثالي|جذاب|رائع|عصري|فريد|مميز|راق|جمالي|ساحر|خلاب)(?:ة|ه|ًا|اً|ا)?)(?!\p{L})/gu;
const LENGTH_WORDS = /(?<!\p{L})(ميدي|ماكسي|ميني)(?!\p{L})/gu;
const LATIN_WORD = /(?<![A-Za-z])[a-z][a-z-]{2,19}(?![A-Za-z])/g;
const FOREIGN_SCRIPT = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/u;
const COLOR_NOUNS = { "وردة": "وردي", "قاعدي": "اسم لون صريح (عاجي، بيج، أبيض مائل للأصفر)" };

// عيوب ترصدها بوابة الجودة برمزها: الخطأ والصواب ثابتان.
const CODE_LESSONS = {
  PROP_ITEM: ["وصف قطعة تلبسها العارضة كأنها المنتج", "صفي القطعة المطابقة لاسم المنتج وحدها"],
  BAD_OPENER: ["افتتاحية «هذه/هذا»", "ابدئي باسم المنتج أو ميزته المرئية"],
  PRICE_IN_PROSE: ["ذكر السعر داخل الوصف", "بلا أي رقم بالريال"],
  TOO_SHORT: ["وصف قصير رغم وجود صورة", "ثلاث فقرات: القطعة، متى وكيف تُلبس، جدول المقاسات"],
  FIELD_STORE_POLICY: ["أسئلة عن الشحن أو الإرجاع أو الدفع", "أسئلة عن القطعة نفسها فقط"],
  FIELD_THIN_HIGHLIGHT: ["نقاط مزايا من كلمة أو كلمتين", "كل نقطة تفصيل مرئي كامل"],
  FIELD_UNSOURCED_JUDGMENT: ["أحكام بالنقاط أو الأسئلة أو الميتا (أنيقة، مريحة، فاخرة)", "تفصيل مرئي بدل الحكم في كل الحقول"]
};

/** يستخرج الدروس من توليد واحد. نقي (بلا D1) ليُختبر مباشرة. */
export function detectLessons({ draft = "", codes = [], final = "", rawNotes = "", notes = "", sourceText = "" } = {}) {
  const out = [];
  const add = (code, wrong, right, target) => {
    const w = String(wrong || "").replace(/[\r\n`]/g, " ").trim().slice(0, 80);
    if (w && !out.some((l) => l.code === code && l.wrong === w)) out.push({ code, wrong: w, right: String(right).slice(0, 120), target });
  };
  const d = String(draft || "");
  const f = String(final || "");
  const src = String(sourceText || "");
  const srcLower = src.toLowerCase();
  const n = String(notes || "");
  const rn = String(rawNotes || "");

  for (const c of codes) if (CODE_LESSONS[c]) add(c, CODE_LESSONS[c][0], CODE_LESSONS[c][1], "writer");
  for (const m of d.matchAll(JUDGMENT_WORDS)) {
    if (!src.includes(m[1]) && !f.includes(m[1])) add("JUDGMENT", m[1], "تفصيل مرئي محدد بدل الحكم", "writer");
  }
  for (const m of d.matchAll(LATIN_WORD)) {
    if (!srcLower.includes(m[0])) add("LATIN_WORD", m[0], fixLatinWords(m[0]) || "كلمة عربية", "writer");
  }
  if (FOREIGN_SCRIPT.test(d)) add("FOREIGN_SCRIPT", "حروف صينية أو يابانية داخل النص", "عربي فقط", "writer");
  if (n) {
    for (const m of d.matchAll(LENGTH_WORDS)) {
      if (!n.includes(m[1])) add("UNSEEN_LENGTH", `«${m[1]}» والصورة لم تذكر طولاً`, "لا طول إلا ما ورد بملاحظات الصورة", "writer");
    }
  }
  if (/(?<!\p{L})(?:ال)?طول\s+والقص[ّ]?ة(?!\s*:)/u.test(d)) add("NOTE_LABEL", "نسخ عنوان الملاحظات «الطول والقصّة»", "صياغة جملة: «بطول ميدي»", "writer");
  const cta = d.match(SALES_CTA);
  if (cta) add("SALES_CTA", `«${cta[0]}…» دعوة بيع داخل الوصف`, "وصف القطعة ومتى تُلبس فقط، بلا دعوة شراء", "writer");
  if (/(?<!\p{L})هذا\s+(?:القطعة|القطع)(?!\p{L})/u.test(d)) add("GRAMMAR", "«هذا القطعة» / «هذا القطع»", "«هذه القطعة»", "writer");
  for (const a of findColorAgreement(d)) add("GRAMMAR", `«${a.wrong}»`, `«${a.right}»`, "writer");
  if (/(?<!\p{L})بايستيل(?!\p{L})/u.test(d)) add("TERM", "«بايستيل»", "«بيزلي»", "writer");
  if (/(?<!\p{L})بايستيل(?!\p{L})/u.test(rn)) add("VISION_TERM", "«بايستيل»", "«بيزلي»", "vision");
  if (/(?<!\p{L})(?:ال)?طابع\s+العام(?!\p{L})/u.test(d)) add("NOTE_LABEL", "نسخ عنوان الملاحظات «الطابع العام» بالوصف", "اكتبي المناسبة نفسها: «للإطلالات النهارية»", "writer");
  if (/(?<!\p{L})ماكسي(?!\p{L})/u.test(d) && /(?<!\p{L})(?:بنطال|بنطلون|جينز)/u.test(src)) add("TROUSER_LENGTH", "«ماكسي» لبنطلون", "«بطول كامل» أو «حتى الكاحل»", "both");

  for (const m of rn.matchAll(LATIN_WORD)) add("VISION_LATIN", m[0], fixLatinWords(m[0]) || "كلمة عربية", "vision");
  if (FOREIGN_SCRIPT.test(rn)) add("VISION_FOREIGN", "حروف صينية داخل الملاحظات", "عربي فقط", "vision");
  if (/(?:الأكمام|الاكمام|الياقة)\s*:\s*(?:لا يوجد|لا توجد|بدون|بلا|غير موجود)/u.test(rn)) {
    add("VISION_EMPTY_LINE", "سطر «الأكمام: لا يوجد» لقطعة بلا أكمام", "احذف السطر كاملاً", "vision");
  }
  for (const [noun, right] of Object.entries(COLOR_NOUNS)) {
    if (new RegExp(`(?<!\\p{L})${noun}(?!\\p{L})`, "u").test(rn)) add("VISION_COLOR_WORD", `«${noun}» بدل اسم لون`, right, "vision");
  }
  if (/(?<!\p{L})(?:العارضة|مرفق|مرفقة|تلبسها)(?!\p{L})/u.test(rn)) {
    add("VISION_EXTRA_ITEM", "وصف العارضة أو ملابسها أو «قطعة مرفقة» بالملاحظات", "صف القطعة المطابقة للعنوان وحدها", "vision");
  }
  return out;
}

/** أكثر الدروس تكراراً (لكل الأهداف) بنداء D1 واحد. غياب الجدول أو عطل D1 = بلا دروس. */
export async function loadLessons(env) {
  if (!env?.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT code, wrong_text, right_text, target FROM copy_lessons ORDER BY hits DESC, last_seen DESC LIMIT 24"
    ).all();
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  }
}

/** كتلة التوجيه لهدف واحد (writer للكاتبين، vision لقارئ الصورة). */
export function lessonsBlock(lessons, target) {
  const rows = (lessons || []).filter((l) => l && (l.target === target || l.target === "both")).slice(0, MAX_LESSONS_PER_PROMPT);
  if (!rows.length) return "";
  const clean = (t) => String(t || "").replace(/[\r\n`]/g, " ").slice(0, 120);
  return "\n\n## دروس من أخطاء رُصدت فعلاً بتوليدات سابقة (الأكثر تكراراً أولاً) — لا تكررها\n" +
    rows.map((l) => `- خطأ: ${clean(l.wrong_text)} ← الصواب: ${clean(l.right_text)}`).join("\n");
}

/** يسجّل دروس التوليد. لا يرمي أبداً: التعلّم لا يُسقط توليد وصف. */
export async function learnFromCopy(env, input) {
  if (!env?.DB) return 0;
  const lessons = detectLessons(input).slice(0, 10);
  if (!lessons.length) return 0;
  try {
    await env.DB.batch(lessons.map((l) => env.DB.prepare(
      "INSERT INTO copy_lessons (code, wrong_text, right_text, target) VALUES (?, ?, ?, ?) ON CONFLICT(code, wrong_text) DO UPDATE SET hits = hits + 1, last_seen = datetime('now')"
    ).bind(l.code, l.wrong, l.right, l.target)));
    return lessons.length;
  } catch {
    return 0;
  }
}

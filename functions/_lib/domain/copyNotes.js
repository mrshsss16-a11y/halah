// تنقية ملاحظات الصورة قبل الكاتب، وحذف ادعاء «قطعة مرفقة» — نُقلت من domain/copy.js بلا تغيير
// سلوكي (2026-09-12) لإفساح سطور ذاكرة الدروس تحت سقف ٤٠٠ سطر.
import { splitSentences, propItemIn } from "./copyParse.js";
import { splitSentencesKeep, joinSentences, dropForeignScript, isBottomItem, fixLatinWords } from "./copyPhrases.js";

// جمل عن العارضة أو عن قطعة غير المنتج تُحذف من ملاحظات الصورة **قبل** الكاتب. السجل الحي
// (2026-09-11، بلوزة متجر المراجعة) أثبت أن النموذج أصرّ على «التنورة…» عبر ثلاث محاولات
// لأن الملاحظات نفسها تصفها — الحارس بعد الكتابة كان يحذف، والمصدر يعيد الإغراء كل مرة.
// ووضعية العارضة أيضاً: «اليد اليمنى في الجيب» وصل وصف بلوزة حقيقي (2026-09-11 22:42 UTC).
const MODEL_PERSON = /(العارضة|عارضة الأزياء|(?<!\p{L})(?:اليد|يدها|يديها|اليدين|ذراعها|تقف|واقفة|وضعية|شعرها|وجهها|الخلفية)(?!\p{L})|(?<!\p{L})model(?!\p{L})|wearing|paired with|pocket|background)/iu;
// قطعة أخرى بأي موضع من الجملة (propItemIn يفحص أول كلمة فقط): «ومرفق به تنورة».
export const otherItem = (text, name) => String(text || "").split(/\s+/).map((w) => w.replace(/[^\p{L}]/gu, "")).some((w) => w && (propItemIn(w, name) || propItemIn(w.replace(/^[وب]/, ""), name)));
export const ATTACHED = /(?<!\p{L})(?:مرفق|مرفقة|مرفقه|يأتي مع|تأتي مع|يشمل|تشمل|طقم)(?!\p{L})/u;
/** ادعاء أن قطعة أخرى تأتي مع المنتج كذب على العميلة: الجملة تُحذف كاملة. */
export function dropAttachedClaims(text, name) {
  return joinSentences(splitSentencesKeep(text).filter(({ s }) => !(ATTACHED.test(s) && otherItem(s, name))));
}
export function productOnlyNotes(notes, name) {
  // بلوزة 2026-09-12 00:06: «اللون: أبيض مع أجزاء سفلية بدرجات من الأزرق…» و«…، ومرفق به تنورة بقصّة A».
  // التصفية على مستوى المقطع: جملة الطول نفسها فيها «توب بقصّة واسعة» الصحيحة.
  return splitSentences(notes)
    .filter((s) => !MODEL_PERSON.test(s) && !propItemIn(s, name))
    // تنورة 2026-09-12 00:40: «الأكمام: لا يوجد.» صارت «وبدون أكمام» بالوصف المنشور.
    .filter((s) => !(isBottomItem(name) && /^\s*(?:الأكمام|الاكمام|الياقة|الكتفان)/u.test(s)))
    .map((s) => fixLatinWords(dropForeignScript(s.replace(/\s*\([A-Za-z][A-Za-z\s-]*\)/g, "")))
      // «وردة فاتح» و«ضيئة» من Qwen نُقلتا حرفياً إلى وصف منشور (2026-09-12 00:42).
      .replace(/(?<!\p{L})وردة(?=\s+(?:فاتح|غامق|سادة|سادة))/gu, "وردي").replace(/(?<!\p{L})ضيئة(?!\p{L})/gu, "ضيقة"))
    .map((s) => s.split(/،\s*|\s+(?=و(?:مرفق|مع|يأتي|تأتي))/u).filter((c) => !otherItem(c, name)).join("، ")
      .replace(/\s*مع\s+(?:ال)?[أا]جزاء\s+سفلي(?:ة|ه)?[^.،]*/gu, "")
      .replace(/مبطن(?:ة|ه)?\s+بالدانتيل/gu, "مطعّمة بالدانتيل")
      .replace(/([^.!؟\s])\s*$/u, "$1."))
    .filter((s) => s.replace(/^[^:]*:\s*/, "").replace(/[.\s]/g, ""))
    .join(" ")
    // Qwen كتب «كاسرات» (2026-09-11 23:58) فنقلها الكاتب حرفياً إلى الوصف المنشور.
    .replace(/(?<!\p{L})(و|ب)?كاسرات(?!\p{L})/gu, "$1كسرات")
    // «بطبعة بايستيل» (جاكيت 2026-09-12 02:35) — تُصحَّح قبل الكاتب لا بعده فقط.
    .replace(/(?<!\p{L})بايستيل(?!\p{L})/gu, "بيزلي").trim();
}

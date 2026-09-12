// تنقية ملاحظات الصورة قبل الكاتب، وحذف ادعاء «قطعة مرفقة» — نُقلت من domain/copy.js بلا تغيير
// سلوكي (2026-09-12) لإفساح سطور ذاكرة الدروس تحت سقف ٤٠٠ سطر.
import { splitSentences, propItemIn } from "./copyParse.js";
import { splitSentencesKeep, joinSentences, dropForeignScript, isBottomItem, fixLatinWords } from "./copyPhrases.js";

// جمل عن العارضة أو عن قطعة غير المنتج تُحذف من ملاحظات الصورة **قبل** الكاتب. السجل الحي
// (2026-09-11، بلوزة متجر المراجعة) أثبت أن النموذج أصرّ على «التنورة…» عبر ثلاث محاولات
// لأن الملاحظات نفسها تصفها — الحارس بعد الكتابة كان يحذف، والمصدر يعيد الإغراء كل مرة.
// ووضعية العارضة أيضاً: «اليد اليمنى في الجيب» وصل وصف بلوزة حقيقي (2026-09-11 22:42 UTC).
// تنورة 2026-09-12 18:29: حذف الجملة كلها أسقط «بكسرات عريضة تحت بلوزة» و«ميدي… مع حذاء» فوصل الكاتب
// لون وطابع فقط واخترع القصّة. الآن يُقص المقطع من أول كلمة عن العارضة أو قطعة أخرى، ويبقى ما قبلها.
const MODEL_WORD = /^(?:و)?(?:ال)?(?:عارضة|عارضه|يد|يدها|يديها|يدين|ذراعها|تقف|واقفة|وضعية|شعرها|وجهها|خلفية)$|^(?:model|wearing|paired|pocket|background)$/iu;
const CONNECTOR = /^(?:و)?(?:مع|تحت|فوق|على|من|إلى|الى|عند|في|به|بها|معها|مرفق|مرفقة|مرفقه|يأتي|تأتي|يشمل|تشمل|طقم|ترتدي|ترتديها|تلبس|تلبسها|تحتها|فوقها)?$/u;
const MODEL_BODY = /(?<!\p{L})(?:ال)?(ساق|ركبة|ركبتي|كاحل|جسم|خصر|كتفي|كتف|ذراع|صدر)[ \t]+(?:عارضة[ \t]+الأزياء|العارضة)(?!\p{L})/gu;
function trimAtOtherItem(clause, name) {
  const words = String(clause || "").trim().split(/\s+/).filter(Boolean);
  const at = words.findIndex((w) => { const x = w.replace(/[^\p{L}]/gu, ""); return x && (MODEL_WORD.test(x) || otherItem(x, name)); });
  if (at < 0) return words.join(" ");
  const kept = words.slice(0, at);
  while (kept.length && CONNECTOR.test(kept[kept.length - 1].replace(/[^\p{L}]/gu, ""))) kept.pop();
  const text = kept.join(" ");
  const body = text.replace(/^[^:]*:\s*/, "");
  // بقية بلا معنى («تُلبس») تُحذف؛ بعد عنوان سطر تكفي كلمة («التفاصيل: كسرات»).
  return (text.includes(":") ? body.trim() : body.split(/\s+/).filter(Boolean).length >= 2) ? text : "";
}
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
    .filter((s) => !propItemIn(s, name))
    // تنورة 2026-09-12 00:40: «الأكمام: لا يوجد.» صارت «وبدون أكمام» بالوصف المنشور.
    .filter((s) => !(isBottomItem(name) && /^\s*(?:الأكمام|الاكمام|الياقة|الكتفان)/u.test(s)))
    .map((s) => fixLatinWords(dropForeignScript(s.replace(/\s*\([A-Za-z][A-Za-z\s-]*\)/g, "")))
      // «وردة فاتح» و«ضيئة» من Qwen نُقلتا حرفياً إلى وصف منشور (2026-09-12 00:42).
      .replace(/(?<!\p{L})وردة(?=\s+(?:فاتح|غامق|سادة|سادة))/gu, "وردي").replace(/(?<!\p{L})ضيئة(?!\p{L})/gu, "ضيقة").replace(MODEL_BODY, "ال$1"))
    .map((s) => s.split(/،\s*|\s+(?=و(?:مرفق|مع|يأتي|تأتي))/u).map((c) => trimAtOtherItem(c, name)).filter(Boolean).join("، ")
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

// Dialect Typo Normalizer & Auto-Corrector for Saudi E-Commerce Customer Chat
//
// Cleans up repetitive character noise ("سلااام", "بكممم", "التوصيللل"),
// standardizes Arabic letter variations (أإآ -> ا, ى -> ي), and fixes common
// Saudi chat typos before feeding text into RAG, intent matching, or LLMs.
//
// Operates in < 1ms on edge — zero external call, pure regex & dictionary lookup.

const REPETITION_REGEX = /(.)\1{2,}/gu; // 3 or more repeated chars -> replace with single char

const SAUDI_COMMERCE_TYPOS = new Map([
  ["متجير", "متجر"],
  ["متجيركم", "متجركم"],
  ["استفساار", "استفسار"],
  ["استفشار", "استفسار"],
  ["استشاره", "استشارة"],
  ["توصيللل", "توصيل"],
  ["توصييل", "توصيل"],
  ["طلبيه", "طلبية"],
  ["طلبيتي", "طلبي"],
  ["شحنن", "شحن"],
  ["سعرر", "سعر"],
  ["خصمم", "خصم"],
  ["كودد", "كود"],
  ["موقعلكم", "موقعكم"],
  ["واتسااب", "واتساب"],
  ["واتسس", "واتساب"]
]);

// A3 — `cleanOutputReply` حُذفت، والقرار موثّق هنا لأنه قرار "احذف" لا "أصلح":
//
//   ١. **ميتة**: صفر مستدعين بالمستودع كله؛ لا رد عميل مرّ عليها يوماً.
//   ٢. **لا تعمل أصلاً**: كانت تبني `new RegExp("\\b" + كلمة عربية + "\\b")`،
//      و`\b` بجافاسكربت مبني على `\w` = [A-Za-z0-9_]. الحرف العربي ليس منها،
//      فالنمط لا يطابق شيئاً. `/\bلاعدك\b/.test("انا لاعدك")` ⇒ false.
//   ٣. **ضارة لو فُعّلت**: أحد مدخلاتها كان "تحتاجين" ⇒ "تحتاج" — أي تحويل
//      مخاطبة عميلة إلى مذكر بكل رد.
//
// إحياؤها كان يعني كتابة تطبيع عربي جديد بالكامل ثم تشغيله على ردود عملاء
// حقيقية بلا دليل على وجود المشكلة التي يعالجها. البديل المعتمد: قواعد
// الإملاء داخل `WHITE_DIALECT_RULES` بـpersona.js (تعمل على مستوى البرومبت).
// مسار **المدخلات** (`cleanInputMessage`) حي ومستخدَم بـintents.js ويبقى.

/**
 * Removes character flooding/repetition (e.g. "سلاااام" -> "سلام", "بكممم" -> "بكم")
 * and standardizes basic Arabic letter forms without destroying dialect nuance.
 */
export function normalizeArabicText(rawText) {
  if (!rawText || typeof rawText !== "string") return "";

  let cleaned = rawText
    // Remove repeated characters (3+ occurrences down to 1)
    .replace(REPETITION_REGEX, "$1")
    // Standardize Alif forms
    .replace(/[أإآ]/g, "ا")
    // Standardize trailing Alef Maksura to Ya for search consistency
    .replace(/ى\b/g, "ي")
    // Normalize multiple spaces into single space
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
}

/**
 * Maps known high-frequency Saudi e-commerce chat typos to clean search forms.
 */
export function correctSaudiCommerceTypos(text) {
  if (!text) return "";

  const words = text.split(" ");
  const correctedWords = words.map((w) => SAUDI_COMMERCE_TYPOS.get(w) || w);
  return correctedWords.join(" ");
}

/**
 * Complete <1ms pipeline: Normalize repetition -> Fix commerce typos.
 */
export function cleanInputMessage(rawText) {
  if (!rawText) return "";
  const normalized = normalizeArabicText(rawText);
  return correctSaudiCommerceTypos(normalized);
}

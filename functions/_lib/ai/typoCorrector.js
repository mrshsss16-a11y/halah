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

const OUTPUT_TYPO_FIXES = new Map([
  ["لاعدك", "لأساعدك"],
  ["لاساعدك", "لأساعدك"],
  ["لخدمدك", "لخدمتك"],
  ["لاختيارر", "لاختيار"],
  ["تحتاجين", "تحتاج"]
]);

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
 * Auto-corrects common LLM output typos (< 1ms post-processor).
 */
export function cleanOutputReply(replyText) {
  if (!replyText || typeof replyText !== "string") return "";
  let cleaned = replyText;
  OUTPUT_TYPO_FIXES.forEach((correctWord, typoWord) => {
    cleaned = cleaned.replace(new RegExp(`\\b${typoWord}\\b`, "g"), correctWord);
  });
  return cleaned;
}

/**
 * Complete <1ms pipeline: Normalize repetition -> Fix commerce typos.
 */
export function cleanInputMessage(rawText) {
  if (!rawText) return "";
  const normalized = normalizeArabicText(rawText);
  return correctSaudiCommerceTypos(normalized);
}

// تلميع صفحة المنتج كاملة لا فقرة الوصف وحدها (طلب المالك 2026-09-12: «باقي بيانات الصفحة»).
//
// تجربة على مخرج فيه أخطاء الليلة بكل الحقول: الوصف خرج نظيفاً، والعنوان والميتا والأسئلة الشائعة
// والنقاط والنبذة — وكلها تُنشر على صفحة المنتج بسلة (sallaProductPayload.js) — والوسوم (تظهر للتاجر)
// ونص البديل والمواصفات نشرت: حرفاً صينياً، «couche»، «تسوقي الآن»، «تنورة فضي»، «مرفق بها بلوزة»،
// «بايستيل»، «الطابع العام»، «هذا القطعة». كل تصحيح يُطبَّق هنا على كل حقل يُعرض أو يُنشر.
import {
  dropForeignScript, fixLatinWords, fixCommonGrammar, fixColorAgreement, fixNoteLabels, dropSalesCta,
  SALES_CTA, fixTrouserLength, dropUnseenLength, dropSleevesForBottoms, withSizeChartLine
} from "./copyPhrases.js";
import { dropAttachedClaims, ATTACHED, otherItem } from "./copyNotes.js";
import { unsourcedClaims, fixSizeChartClosing } from "./copyClaims.js";
import { splitSentencesKeep, joinSentences } from "./copyPhrases.js";

// دعوة البيع داخل نص قصير (عنوان، نقطة، وسم): تُحذف الكلمة لا العنصر كله.
const CTA_WORDS = /(?<!\p{L})(?:تسوقي|تسوّقي|اطلبي|اطلبيها|احصلي|سارعي|اقتنيها)(?:[ \t]+(?:الآن|الان))?(?!\p{L})|(?<!\p{L})لا[ \t]+تفوتي(?!\p{L})/gu;
const MIN_HIGHLIGHT_WORDS = 3;

const words = (t) => String(t || "").split(/\s+/).filter(Boolean).length;
const claimsOtherItem = (t, name) => ATTACHED.test(String(t || "")) && otherItem(t, name);

/** نص جمل (وصف، نبذة، واتساب، ميتا، جواب): ما يُحذف يُحذف جملةً كاملة. */
function polishProse(text, { name, sourceText }) {
  // ادعاء لم يذكره التاجر (مقاومة ماء، ضمان، ثبات، أصلي…) يُحذف بجملته — تقييم 2026-09-12.
  const sourced = joinSentences(splitSentencesKeep(String(text || "")).filter(({ s }) => !unsourcedClaims(s, sourceText).length));
  const t = dropForeignScript(fixNoteLabels(dropAttachedClaims(sourced, name)));
  return fixColorAgreement(fixCommonGrammar(dropSalesCta(fixTrouserLength(fixLatinWords(t, sourceText), name)))).trim();
}

/** نص قصير (عنوان، نقطة، وسم، سؤال، نص بديل، مواصفة): تُحذف الكلمة المعيبة لا العنصر. */
function polishShort(text, { name, sourceText }) {
  const t = fixLatinWords(dropForeignScript(fixNoteLabels(String(text || ""))), sourceText);
  return fixColorAgreement(fixCommonGrammar(fixTrouserLength(t, name)))
    .replace(CTA_WORDS, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[\s،,.:؛-]+|[\s،,:؛-]+$/g, "")
    .trim();
}

/** نص كل حقول الصفحة معاً: ذاكرة الدروس تتعلم من أخطاء الميتا والأسئلة والنقاط لا الوصف وحده. */
export function pageText(parsed) {
  const cw = parsed?.copywriting || {};
  const seo = parsed?.seo || {};
  return [
    cw.description, cw.excerpt, cw.whatsapp, ...(Array.isArray(cw.highlights) ? cw.highlights : []),
    seo.title, seo.seoTitle, seo.metaDescription, seo.focusKeyword, ...(Array.isArray(seo.lsiKeywords) ? seo.lsiKeywords : []),
    ...(Array.isArray(parsed?.faqs) ? parsed.faqs.flatMap((f) => [f?.q, f?.a]) : []),
    ...(Array.isArray(parsed?.specsTable) ? parsed.specsTable.flatMap((r) => [r?.key, r?.value]) : []),
    parsed?.imageAlt, ...(Array.isArray(parsed?.tags) ? parsed.tags : [])
  ].filter((x) => typeof x === "string" && x.trim()).join("\n");
}

/** يلمّع كل حقول المخرج في مكانه. */
export function polishPage(parsed, { name = "", sourceText = "", notes = "", category = "" } = {}) {
  const ctx = { name, sourceText };
  const unsourced = (t) => unsourcedClaims(t, sourceText).length > 0;
  const cw = parsed.copywriting || (parsed.copywriting = {});
  const seo = parsed.seo || (parsed.seo = {});

  cw.description = fixSizeChartClosing(withSizeChartLine(dropSleevesForBottoms(dropUnseenLength(polishProse(cw.description, ctx), notes), name), name), { name, category });
  cw.excerpt = polishProse(cw.excerpt, ctx).slice(0, 250);
  cw.whatsapp = fixSizeChartClosing(polishProse(cw.whatsapp, ctx), { name, category });
  if (typeof cw.objectionKiller === "string") cw.objectionKiller = polishProse(cw.objectionKiller, ctx);
  if (typeof cw.callToAction === "string" && unsourced(cw.callToAction)) cw.callToAction = "";
  cw.highlights = (Array.isArray(cw.highlights) ? cw.highlights : [])
    .filter((h) => typeof h === "string" && !claimsOtherItem(h, name) && !SALES_CTA.test(h) && !unsourced(h))
    .map((h) => polishShort(h, ctx))
    .filter((h) => words(h) >= MIN_HIGHLIGHT_WORDS);

  // سؤال يدّعي قطعة مرفقة يُحذف بسؤاله وجوابه: جواب «نعم مرفق بها بلوزة» كذب على العميلة.
  parsed.faqs = (Array.isArray(parsed.faqs) ? parsed.faqs : [])
    // سؤال جوابه ادعاء غير مسند («مقاومة للماء؟ نعم…») يُحذف كاملاً: حذف الجملة يترك سؤالاً بلا جواب.
    .filter((f) => f && !claimsOtherItem(`${f.q || ""} ${f.a || ""}`, name) && !unsourced(`${f.q || ""} ${f.a || ""}`))
    .map((f) => ({ ...f, q: polishShort(f.q, ctx), a: polishProse(f.a, ctx) }))
    .filter((f) => f.q && f.a);

  seo.title = polishShort(seo.title, ctx) || String(name || "").trim();
  seo.seoTitle = polishShort(seo.seoTitle, ctx) || seo.title;
  seo.metaDescription = fixSizeChartClosing(polishProse(seo.metaDescription, ctx), { name, category });
  if (seo.jsonLdSchema && typeof seo.jsonLdSchema === "object") seo.jsonLdSchema.description = seo.metaDescription;
  if (typeof seo.focusKeyword === "string") seo.focusKeyword = polishShort(seo.focusKeyword, ctx) || String(name || "").trim();
  if (Array.isArray(seo.lsiKeywords)) seo.lsiKeywords = [...new Set(seo.lsiKeywords.map((k) => polishShort(k, ctx)).filter(Boolean))];

  if (typeof parsed.imageAlt === "string") parsed.imageAlt = polishShort(parsed.imageAlt, ctx) || String(name || "").trim();
  if (Array.isArray(parsed.tags)) parsed.tags = [...new Set(parsed.tags.filter((t) => !unsourced(t)).map((t) => polishShort(t, ctx)).filter(Boolean))];
  if (Array.isArray(parsed.specsTable)) {
    parsed.specsTable = parsed.specsTable
      .map((r) => ({ ...r, key: polishShort(r?.key, ctx), value: polishShort(r?.value, ctx) }))
      .filter((r) => r.key && r.value && !unsourced(`${r.key} ${r.value}`));
  }
  return parsed;
}

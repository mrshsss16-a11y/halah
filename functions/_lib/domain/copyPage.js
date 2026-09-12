// تلميع صفحة المنتج كاملة لا فقرة الوصف وحدها (طلب المالك 2026-09-12: «باقي بيانات الصفحة»).
//
// تجربة على مخرج فيه أخطاء الليلة بكل الحقول: الوصف خرج نظيفاً، والعنوان والميتا والأسئلة الشائعة
// والنقاط والنبذة — وكلها تُنشر على صفحة المنتج بسلة (sallaProductPayload.js) — والوسوم (تظهر للتاجر)
// ونص البديل والمواصفات نشرت: حرفاً صينياً، «couche»، «تسوقي الآن»، «تنورة فضي»، «مرفق بها بلوزة»،
// «بايستيل»، «الطابع العام»، «هذا القطعة». كل تصحيح يُطبَّق هنا على كل حقل يُعرض أو يُنشر.
import {
  dropForeignScript, fixLatinWords, fixCommonGrammar, fixColorAgreement, fixNoteLabels, dropSalesCta,
  SALES_CTA, fixTrouserLength, dropUnseenLength, dropSleevesForBottoms, withSizeChartLine,
  dropUnseenCut, unseenCutPhrases
} from "./copyPhrases.js";
import { dropAttachedClaims, ATTACHED, otherItem } from "./copyNotes.js";
import { unsourcedClaims, fixSizeChartClosing } from "./copyClaims.js";
import { splitSentencesKeep, joinSentences } from "./copyPhrases.js";

// دعوة البيع داخل نص قصير (عنوان، نقطة، وسم): تُحذف الكلمة لا العنصر كله.
const CTA_WORDS = /(?<!\p{L})(?:تسوقي|تسوّقي|اطلبي|اطلبيها|احصلي|سارعي|اقتنيها)(?:[ \t]+(?:الآن|الان))?(?!\p{L})|(?<!\p{L})لا[ \t]+تفوتي(?!\p{L})/gu;
const MIN_HIGHLIGHT_WORDS = 3;

const words = (t) => String(t || "").split(/\s+/).filter(Boolean).length;
const claimsOtherItem = (t, name) => ATTACHED.test(String(t || "")) && otherItem(t, name);

// ── تنظيف آلي لصفحة كتبها نموذج أضعف (تنورة 2026-09-13 01:01، Cloudflare) ─────────────────────────
const normKey = (t) => String(t || "").replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// نبذة «…لامع. متوفرة… تنورة سوداء ميدي بقصّة واسعة… لامع.» كررت جملتها الأولى داخل الحقل نفسه.
function dropRepeatedSentences(text) {
  const seen = new Set();
  return joinSentences(splitSentencesKeep(String(text || "")).filter(({ s }) => {
    const k = normKey(s);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  }));
}
// «متوفرة بمقاسات من 36 - XL»: النموذج دمج أول رقم بآخر حرف من خيارات التاجر. المدى يُبنى من الخيارات نفسها.
const SIZE_PAIR = /(\d{2})\s*-\s*(X{0,3}[SML]|X{1,3}L)(?![A-Za-z])/g;
function sizeOptions(sourceText) {
  const seen = new Map();
  for (const m of String(sourceText || "").matchAll(SIZE_PAIR)) seen.set(`${m[1]}-${m[2]}`, { n: Number(m[1]), l: m[2] });
  return [...seen.values()].sort((a, b) => a.n - b.n);
}
function fixSizeRange(text, sizes = []) {
  if (sizes.length < 2) return String(text || "");
  const valid = new Set(sizes.map((z) => `${z.n}-${z.l}`));
  const range = `${sizes[0].n} (${sizes[0].l}) إلى ${sizes[sizes.length - 1].n} (${sizes[sizes.length - 1].l})`;
  return String(text || "").replace(/(\d{2})\s*-\s*(X{0,3}[SML]|X{1,3}L)(?![A-Za-z])(\s*(?:إلى|الى|حتى)\s*\d{2}\s*-\s*(?:X{0,3}[SML]|X{1,3}L))?/g,
    (m, n, l, tail) => (tail || valid.has(`${n}-${l}`) ? m : range));
}
const bareWords = (t) => new Set(normKey(t).split(" ").map((w) => w.replace(/^(?:و|ب)(?=\p{L}{3,})/u, "").replace(/^ال(?=\p{L}{2,})/u, "")).filter(Boolean));
// وسم كلمة واحدة هي صفة لون أو طول أو قصّة («أسود»، «ميدي»، «واسعة») لا يُبحث به وحده.
const BARE_ADJ_TAG = /^(?:ال)?(?:[أا]سود|سوداء|[أا]بيض|بيضاء|[أا]حمر|حمراء|[أا]زرق|زرقاء|[أا]خضر|خضراء|وردي(?:ة)?|بيج|كحلي(?:ة)?|رمادي(?:ة)?|ذهبي(?:ة)?|فضي(?:ة)?|ميدي|ماكسي|ميني|واسع(?:ة)?|ضيق(?:ة)?|مستقيم(?:ة)?|لامع(?:ة)?|مطفي(?:ة)?|سادة|رسمي(?:ة)?|يومي(?:ة)?|قصير(?:ة)?|طويل(?:ة)?)$/u;

/** نص جمل (وصف، نبذة، واتساب، ميتا، جواب): ما يُحذف يُحذف جملةً كاملة. */
function polishProse(text, { name, sourceText, sizes }) {
  // ادعاء لم يذكره التاجر (مقاومة ماء، ضمان، ثبات، أصلي…) يُحذف بجملته — تقييم 2026-09-12.
  const sourced = joinSentences(splitSentencesKeep(String(text || "")).filter(({ s }) => !unsourcedClaims(s, sourceText).length));
  const t = dropForeignScript(fixNoteLabels(dropAttachedClaims(sourced, name)));
  return dropRepeatedSentences(fixSizeRange(fixColorAgreement(fixCommonGrammar(dropSalesCta(fixTrouserLength(fixLatinWords(t, sourceText), name)))), sizes))
    // «…من الخصر، سطحها اللامع.» ⇒ «…، وسطحها لامع.» (نبذة وميتا حقيقيتان 2026-09-12 18:46).
    .replace(/،[ \t]*(\p{L}+ها)[ \t]+ال(\p{L}+)(?=[ \t]*(?:[.!؟]|$))/gu, "، و$1 $2")
    // «ويمكن ارتداؤه في العديد من المناسبات غير الرسمية» — عبارة عامة لا تصف القطعة (فستانان 2026-09-13).
    .replace(/[ \t]*،?[ \t]*(?:و)?(?:يمكن|يمكنك|تقدرين)[ \t]+(?:ارتداؤه|ارتداؤها|ارتداءه|ارتداءها|لبسه|لبسها)[ \t]+(?:في[ \t]+)?(?:العديد[ \t]+من|مختلف|كل|جميع)[ \t]+(?:ال)?مناسبات(?:[ \t]+(?:غير[ \t]+)?(?:ال)?\p{L}+)?/gu, "")
    // «المناسبات اليومية والغير رسمية» ⇒ «وغير الرسمية».
    .replace(/(?<!\p{L})(و)?ال(غير)[ \t]+(?!ال)(\p{L}+)/gu, "$1$2 ال$3")
    // «جدول المقاسات الموجود بالوصف»: الوصف لا يحوي جدولاً.
    .replace(/[ \t]*(?:ال)?موجود[ \t]+(?:ب|في[ \t]+)(?:ال)?وصف(?!\p{L})/gu, "")
    // «راجعي جدول المقاسات الموضح أدناه» (تنورة 2026-09-12 21:11): لا جدول تحت الوصف.
    .replace(/[ \t]*(?:ال)?(?:موضح|موضّح|موجود)[ \t]+(?:أدناه|ادناه|بالأسفل|في[ \t]+الأسفل)(?!\p{L})/gu, "")
    .trim();
}

/** نص قصير (عنوان، نقطة، وسم، سؤال، نص بديل، مواصفة): تُحذف الكلمة المعيبة لا العنصر. */
function polishShort(text, { name, sourceText, sizes, keepLabels = false }) {
  // مفتاح المواصفة «الطول والقصّة» اسم صحيح لا عنوان ملاحظات مسرّب — صار «بطول» (2026-09-12 18:46).
  const raw = String(text || "");
  const t = fixLatinWords(dropForeignScript(keepLabels ? raw : fixNoteLabels(raw)), sourceText);
  return fixSizeRange(fixColorAgreement(fixCommonGrammar(fixTrouserLength(t, name))), sizes)
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
  const ctx = { name, sourceText, sizes: sizeOptions(sourceText) };
  const unsourced = (t) => unsourcedClaims(t, sourceText).length > 0;
  // قصّة أو خصر أو كسرات لم ترها الصورة (تنورة 2026-09-12 18:29) — تُحذف من كل حقل، لا الوصف وحده.
  const cut = (t) => dropUnseenCut(t, { notes, sourceText, name });
  const unseenCut = (t) => unseenCutPhrases(t, notes, sourceText).length > 0;
  const cw = parsed.copywriting || (parsed.copywriting = {});
  const seo = parsed.seo || (parsed.seo = {});

  cw.description = fixSizeChartClosing(withSizeChartLine(dropSleevesForBottoms(dropUnseenLength(cut(polishProse(cw.description, ctx)), notes), name), name), { name, category });
  cw.excerpt = cut(polishProse(cw.excerpt, ctx)).slice(0, 250);
  cw.whatsapp = fixSizeChartClosing(cut(polishProse(cw.whatsapp, ctx)), { name, category });
  // «يا هلا! إطلالة رسمية. وش رايك فيها؟» — بقي تحية وسؤالاً بعد حذف الأحكام: يُبنى من النبذة بدل رسالة فارغة.
  const whatsappBody = cw.whatsapp.replace(/(?<!\p{L})(?:يا[ \t]+هلا|هلا|أهلاً|اهلا|مرحبا|وش[ \t]+رايك[ \t]+فيها|وش[ \t]+رأيك[ \t]+فيها|إطلالة[ \t]+رسمية)(?!\p{L})/gu, "");
  if (words(whatsappBody.replace(/[^\p{L}\s]/gu, " ")) < 6 && words(cw.excerpt) >= 6) cw.whatsapp = cw.excerpt;
  if (typeof cw.objectionKiller === "string") cw.objectionKiller = polishProse(cw.objectionKiller, ctx);
  if (typeof cw.callToAction === "string" && unsourced(cw.callToAction)) cw.callToAction = "";
  cw.highlights = (Array.isArray(cw.highlights) ? cw.highlights : [])
    .filter((h) => typeof h === "string" && !claimsOtherItem(h, name) && !SALES_CTA.test(h) && !unsourced(h))
    .map((h) => cut(polishShort(h, ctx)))
    .filter((h) => words(h) >= MIN_HIGHLIGHT_WORDS);
  // نقطة لا تضيف كلمة خارج العنوان واسم المنتج («تنورة ميدي سوداء بكسرات عريضة») تكرار لا ميزة. تلخيص جملة
  // الوصف مسموح: النقاط تُقرأ وحدها على صفحة سلة («سوار فولاذي بثلاثة صفوف»).
  const known = new Set([seo.title, name].flatMap((t) => [...bareWords(t)]));
  cw.highlights = cw.highlights.filter((h) => [...bareWords(h)].some((w) => !known.has(w)));

  // سؤال يدّعي قطعة مرفقة يُحذف بسؤاله وجوابه: جواب «نعم مرفق بها بلوزة» كذب على العميلة.
  parsed.faqs = (Array.isArray(parsed.faqs) ? parsed.faqs : [])
    // سؤال جوابه ادعاء غير مسند («مقاومة للماء؟ نعم…») يُحذف كاملاً: حذف الجملة يترك سؤالاً بلا جواب.
    .filter((f) => f && !claimsOtherItem(`${f.q || ""} ${f.a || ""}`, name) && !unsourced(`${f.q || ""} ${f.a || ""}`) && !unseenCut(`${f.q || ""} ${f.a || ""}`))
    .map((f) => ({ ...f, q: polishShort(f.q, ctx), a: polishProse(f.a, ctx) }))
    // جواب من كلمة أو ثلاث بلا رقم («اللون أسود.») يعيد مواصفة لا يجيب سؤالاً؛ «40 ملم.» معلومة تبقى.
    .filter((f) => f.q && f.a && (words(f.a) >= 4 || /[\d٠-٩]/.test(f.a)));

  seo.title = cut(polishShort(seo.title, ctx)) || String(name || "").trim();
  seo.seoTitle = cut(polishShort(seo.seoTitle, ctx)) || seo.title;
  seo.metaDescription = fixSizeChartClosing(cut(polishProse(seo.metaDescription, ctx)), { name, category });
  if (seo.jsonLdSchema && typeof seo.jsonLdSchema === "object") seo.jsonLdSchema.description = seo.metaDescription;
  if (typeof seo.focusKeyword === "string") seo.focusKeyword = polishShort(seo.focusKeyword, ctx) || String(name || "").trim();
  if (Array.isArray(seo.lsiKeywords)) seo.lsiKeywords = [...new Set(seo.lsiKeywords.filter((k) => !unsourced(k) && !unseenCut(k)).map((k) => polishShort(k, ctx)).filter(Boolean))];

  if (typeof parsed.imageAlt === "string") parsed.imageAlt = cut(polishShort(parsed.imageAlt, ctx)) || String(name || "").trim();
  // SEO-20 (قائمة الفحص القديمة المنقّحة): وسوم بلا تكرار بعد تطبيع الحروف (ة/ه، أ/ا، ى/ي).
  if (Array.isArray(parsed.tags)) {
    const tagKey = (t) => t.replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
    const seenTags = new Set();
    parsed.tags = parsed.tags.filter((t) => !unsourced(t) && !unseenCut(t)).map((t) => polishShort(t, ctx)).filter((t) => t && !BARE_ADJ_TAG.test(t) && !seenTags.has(tagKey(t)) && seenTags.add(tagKey(t)));
  }
  if (Array.isArray(parsed.specsTable)) {
    parsed.specsTable = parsed.specsTable
      .map((r) => ({ ...r, key: polishShort(r?.key, { ...ctx, keepLabels: true }), value: polishShort(r?.value, ctx) }))
      .filter((r) => r.key && r.value && !unsourced(`${r.key} ${r.value}`) && !unseenCut(`${r.key} ${r.value}`));
  }
  return parsed;
}

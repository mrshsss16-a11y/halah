// تلميع صفحة المنتج كاملة لا فقرة الوصف وحدها (طلب المالك 2026-09-12: «باقي بيانات الصفحة»).
//
// تجربة على مخرج فيه أخطاء الليلة بكل الحقول: الوصف خرج نظيفاً، والعنوان والميتا والأسئلة الشائعة
// والنقاط والنبذة — وكلها تُنشر على صفحة المنتج بسلة (sallaProductPayload.js) — والوسوم (تظهر للتاجر)
// ونص البديل والمواصفات نشرت: حرفاً صينياً، «couche»، «تسوقي الآن»، «تنورة فضي»، «مرفق بها بلوزة»،
// «بايستيل»، «الطابع العام»، «هذا القطعة». كل تصحيح يُطبَّق هنا على كل حقل يُعرض أو يُنشر.
//
// 2026-09-13: حالات صناعية أثبتت أن حراساً كثيرة بقيت لحقل واحد — الأحكام والطول غير المرئي و«بدون أكمام»
// للوصف، «الغير» للنثر، جدول المقاسات للوصف والواتساب والميتا، والسعر والعنصر النائب للنثر. صارت كلها هنا لكل حقل.
import {
  dropForeignScript, fixLatinWords, fixCommonGrammar, fixColorAgreement, fixNoteLabels, dropSalesCta,
  SALES_CTA, fixTrouserLength, dropUnseenLength, dropSleevesForBottoms, withSizeChartLine,
  dropUnseenCut, unseenCutPhrases, splitSentencesKeep, joinSentences
} from "./copyPhrases.js";
import { dropAttachedClaims, dropPhotoLeaks, ATTACHED, otherItem } from "./copyNotes.js";
import { unsourcedClaims, fixSizeChartClosing } from "./copyClaims.js";
import { unsourcedJudgment, stripJudgments, stripJudgmentWords, hasPraiseIdiom } from "./copyJudgments.js";
import { propItemIn, sourcedPropItem } from "./copyParse.js";
import { stripUnsourcedOccasions } from "./copyOccasion.js";
// «يظهر التصميم… في النموذج المعروض» و«ونقشتها منقوشة» و«جيوب عملية» (صفحتان حقيقيتان 2026-09-15): لكل حقل.
import { dropMechanismClauses, dropEmptyQualifiers } from "./copyLeaks.js";

// دعوة البيع داخل نص قصير (عنوان، نقطة، وسم): تُحذف الكلمة لا العنصر كله — «قميص رجالي كتان اطلبه الحين».
const CTA_WORDS = /(?<!\p{L})(?:تسوقي|تسوّقي|اطلبي|اطلبيها|اطلبه|اطلبها|احصلي|سارعي|اقتنيها|احجزيها|احجزي|خذيها|كلمينا|راسلينا|الحقي(?:[ \t]+(?:ب|على)[ \t]*\p{L}+)?)(?:[ \t]+(?:الآن|الان|الحين|اليوم))?(?!\p{L})|(?<!\p{L})لا[ \t]+تفوتي(?!\p{L})|(?<!\p{L})(?:تبين|تبغين)[ \t]+تطلبين؟?/gu;
// عنصر نائب («{الخامة}») وسعر («259 ريال») بوسم أو مواصفة (2026-09-13): حارسهما كان للنثر وحده.
const PLACEHOLDER_TOKEN = /[ \t]*[^\s{}]*\{[^}]*\}\S*/gu;
const PRICE_RE = "[\\d٠-٩][\\d٠-٩.,]*[ \\t]*(?:ريال|ر\\.?س\\.?|SAR|﷼)(?!\\p{L})";
const PRICE_TOKEN = new RegExp(`[ \\t]*(?:(?:ب)?(?:السعر|سعر(?:ه|ها)?)[ \\t]*[:：]?[ \\t]*)?${PRICE_RE}(?:[ \\t]+فقط)?(?:[ \\t]+(?:اليوم|الآن|الان))?`, "gu");
const hasPlaceholderOrPrice = (s) => /[{}]/.test(s) || new RegExp(PRICE_RE, "u").test(s);
const MIN_HIGHLIGHT_WORDS = 3;
// عبارة عامة لا تصف القطعة — بالنثر وبالنقاط («قصة بشت واسعة تناسب جميع المناسبات»، أرشيف 2026-09-13).
const GENERAL_FILLER = [
  /[ \t]*،?[ \t]*(?:و)?(?:ت|ي)?(?:ناسب|مناسب(?:ة|ه)?|ملائم(?:ة|ه)?)[ \t]+(?:ل)?(?:مختلف|جميع|كل|العديد[ \t]+من)[ \t]+(?:ال)?(?:مناسبات|إطلالات|اطلالات|أوقات|اوقات|أذواق|اذواق|أعمار|اعمار)(?:[ \t]+(?:غير[ \t]+)?ال\p{L}+)?(?!\p{L})/gu,
  /[ \t]*،?[ \t]*(?:و)?ل(?:مختلف|جميع|كل)[ \t]+(?:ال)?(?:مناسبات|إطلالات|اطلالات|أوقات|اوقات)(?:[ \t]+(?:غير[ \t]+)?ال\p{L}+)?(?!\p{L})/gu
];

const words = (t) => String(t || "").split(/\s+/).filter(Boolean).length;
const claimsOtherItem = (t, name, sourceText = "") => ATTACHED.test(String(t || "")) && otherItem(t, name) && !sourcedPropItem(t, name, sourceText);

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
function polishProse(text, { name, sourceText, sizes, notes, category }) {
  // ادعاء لم يذكره التاجر (مقاومة ماء، ضمان، ثبات، أصلي…) يُحذف بجملته — تقييم 2026-09-12. حكم الجودة يُزال
  // بعبارته أو مقطعه وتبقى الجملة، ومشهد التصوير بمقطعه (2026-09-13).
  const sourced = joinSentences(splitSentencesKeep(dropPhotoLeaks(dropEmptyQualifiers(dropMechanismClauses(text), sourceText), name))
    .map((p) => ({ ...p, s: unsourcedJudgment(p.s, sourceText) ? stripJudgments(p.s, { sourceText, name }) : p.s }))
    .filter(({ s }) => s && !unsourcedClaims(s, sourceText).length && !unsourcedJudgment(s, sourceText) && !hasPlaceholderOrPrice(s)));
  const t = dropSleevesForBottoms(dropUnseenLength(dropForeignScript(fixNoteLabels(dropAttachedClaims(sourced, name, sourceText))), notes), name);
  const out = dropRepeatedSentences(fixSizeRange(fixColorAgreement(fixCommonGrammar(dropSalesCta(fixTrouserLength(fixLatinWords(t, sourceText), name)))), sizes))
    // «…من الخصر، سطحها اللامع.» ⇒ «…، وسطحها لامع.» (نبذة وميتا حقيقيتان 2026-09-12 18:46).
    .replace(/،[ \t]*(\p{L}+ها)[ \t]+ال(\p{L}+)(?=[ \t]*(?:[.!؟]|$))/gu, "، و$1 $2")
    // «ويمكن ارتداؤه في العديد من المناسبات غير الرسمية» — عبارة عامة لا تصف القطعة (فستانان 2026-09-13).
    .replace(/[ \t]*،?[ \t]*(?:و)?(?:يمكن|يمكنك|تقدرين)[ \t]+(?:ارتداؤه|ارتداؤها|ارتداءه|ارتداءها|لبسه|لبسها)[ \t]+(?:في[ \t]+)?(?:العديد[ \t]+من|مختلف|كل|جميع)[ \t]+(?:ال)?مناسبات(?:[ \t]+(?:غير[ \t]+)?(?:ال)?\p{L}+)?/gu, "")
    // «تناسب جميع المناسبات» · «لمختلف الإطلالات» بلا صفة حكم مجاورة (أرشيف ٢٧ توليداً حقيقياً، 2026-09-13).
    .replace(GENERAL_FILLER[0], "").replace(GENERAL_FILLER[1], "")
    // «متوفر الآن بعدة مقاسات ومناسب لإطلالة.» — بقية حكم حُذف قبل وصول النص (حالات صناعية 2026-09-13).
    .replace(/[ \t]*(?<!\p{L})(?:و?(?:(?:ت|ي)ناسب|مناسب(?:ة|ه)?)[ \t]+)?(?:ل|ب)(?:إطلالة|اطلالة|مظهر(?:اً|ًا|ا)?|لمسة)(?=[ \t]*(?:[.،!؟]|$))/gu, "")
    // «بقصّة واسعة وتصميم، تتميز…»: اسم بقي معلّقاً بعد حذف صفته بتنظيف سابق.
    .replace(/[ \t]*(?<!\p{L})(?:و|ب)(?:تصميم|طابع|لمسة|مظهر|إطلالة|اطلالة)(?=[ \t]*[،.!؟])/gu, "")
    .replace(/،[ \t]*(?=[.!؟])/gu, "")
    .replace(/(?<=^|[.!؟\n])[ \t]*[.،](?=\s|$)/gu, "")
    // إحالات بلا مضمون (منتجات صعبة 2026-09-13): «كما وردت في بيانات المنتج» كشف آلية، و«وفق إرشادات المتجر»
    // و«راجع طريقة التحضير المناسبة لك» تحيل لمعلومة غير منشورة — الإحالة ليست إجابة (معيار C2).
    .replace(/[ \t]*،?[ \t]*(?<!\p{L})(?:كما|مثل[ \t]+ما)[ \t]+(?:ورد(?:ت)?|ذُكر(?:ت)?|ذكرت?)[ \t]+(?:في|ب)[ \t]*(?:ال)?(?:بيانات|وصف|معلومات)[ \t]+(?:ال)?(?:منتج|متجر)(?!\p{L})/gu, "")
    .replace(/(?<=^|[.!؟\n])[ \t]*[^.!؟\n]*(?:وفق|حسب|بحسب)[ \t]+(?:إرشادات|ارشادات|تعليمات)[ \t]+(?:ال)?متجر[^.!؟\n]*[.!؟]?/gu, "")
    .replace(/(?<=^|[.!؟\n])[ \t]*راجع(?:ي)?[ \t]+طريقة[ \t]+(?:ال)?(?:تحضير|استخدام)[ \t]+(?:ال)?مناسب(?:ة)?[ \t]+(?:لك|لكِ)[^.!؟\n]*[.!؟]?/gu, "")
    // «جدول المقاسات الموجود بالوصف»: الوصف لا يحوي جدولاً.
    .replace(/[ \t]*(?:ال)?موجود[ \t]+(?:ب|في[ \t]+)(?:ال)?وصف(?!\p{L})/gu, "")
    // «راجعي جدول المقاسات الموضح أدناه» (تنورة 2026-09-12 21:11): لا جدول تحت الوصف.
    .replace(/[ \t]*(?:ال)?(?:موضح|موضّح|موجود)[ \t]+(?:أدناه|ادناه|بالأسفل|في[ \t]+الأسفل)(?!\p{L})/gu, "")
    .trim();
  // جملة جدول المقاسات لعطر أو ساعة — بالأسئلة الشائعة أيضاً لا الوصف وحده (2026-09-13).
  return fixSizeChartClosing(out, { name, category, sourceText });
}

// «بنطلون رجالي» لبنطلون نسائي بنقشة مورّدة (2026-09-14 01:03): جنس لم يذكره التاجر ولا تصنيفه — يُحذف من كل الحقول.
// الرجالي وحده: «نسائية» صحيحة غالباً بمتاجر الأزياء، وحذفها كسر تطابق الألوان («تنورة نسائية سوداء» ⇒ «تنورة أسود»).
const GENDER_WORD = /[ \t]*(?<!\p{L})(?:رجالي(?:ة|ه)?|للرجال)(?!\p{L})/gu;
function dropUnsourcedGender(parsed, source) {
  if (/(?<!\p{L})(?:رجال|رجالي|ولادي|شبابي)/u.test(String(source))) return;
  const clean = (t) => (typeof t === "string" ? fixColorAgreement(t.replace(GENDER_WORD, "")).replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([،,.!؟])/gu, "$1").trim() : t);
  const cw = parsed.copywriting || {}; const seo = parsed.seo || {};
  for (const k of ["description", "excerpt", "whatsapp"]) cw[k] = clean(cw[k]);
  if (Array.isArray(cw.highlights)) cw.highlights = cw.highlights.map(clean).filter(Boolean);
  for (const k of ["title", "seoTitle", "metaDescription", "focusKeyword"]) seo[k] = clean(seo[k]);
  if (Array.isArray(seo.lsiKeywords)) seo.lsiKeywords = [...new Set(seo.lsiKeywords.map(clean).filter(Boolean))];
  if (typeof parsed.imageAlt === "string") parsed.imageAlt = clean(parsed.imageAlt);
  if (Array.isArray(parsed.tags)) parsed.tags = [...new Set(parsed.tags.map(clean).filter(Boolean))];
}

/** نص قصير (عنوان، نقطة، وسم، سؤال، نص بديل، مواصفة): تُحذف الكلمة المعيبة لا العنصر. */
function polishShort(text, { name, sourceText, sizes, notes, category, keepLabels = false }) {
  // مفتاح المواصفة «الطول والقصّة» اسم صحيح لا عنوان ملاحظات مسرّب — صار «بطول» (2026-09-12 18:46).
  const raw = stripJudgmentWords(dropPhotoLeaks(dropEmptyQualifiers(dropMechanismClauses(text), sourceText).replace(PLACEHOLDER_TOKEN, "").replace(PRICE_TOKEN, ""), name), sourceText);
  const t = fixLatinWords(dropForeignScript(keepLabels ? raw : fixNoteLabels(raw)), sourceText);
  const fixed = dropSleevesForBottoms(dropUnseenLength(fixSizeRange(fixColorAgreement(fixCommonGrammar(fixTrouserLength(t, name))), sizes), notes), name);
  return fixSizeChartClosing(fixed, { name, category, sourceText })
    .replace(GENERAL_FILLER[0], "").replace(GENERAL_FILLER[1], "")
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

// «… للسهرات. فستان سهرة بنفسجي بذيل، بقصّة ضيقة وياقة» (nexos 2026-09-13): ميتا قصيرة أُكملت بنبذة تبدأ بنفس
// الافتتاح ثم قُصّت عند ١٦٠. التكرار يُقطع، ونصف الجملة الأخيرة يُترك لآخر جملة تامة.
function trimMetaRepeat(meta) {
  const t = String(meta || "").trim();
  const head = t.split(/\s+/).slice(0, 4).join(" ");
  const again = head.split(" ").length === 4 ? t.indexOf(head, head.length) : -1;
  let out = again > 0 ? t.slice(0, again).trim() : t;
  const end = Math.max(out.lastIndexOf("."), out.lastIndexOf("؟"), out.lastIndexOf("!"));
  if (!/[.!؟]$/u.test(out) && end >= 60) out = out.slice(0, end + 1);
  return out;
}

/** يلمّع كل حقول المخرج في مكانه. */
export function polishPage(parsed, { name = "", sourceText = "", notes = "", category = "" } = {}) {
  const ctx = { name, sourceText, notes, category, sizes: sizeOptions(sourceText) };
  const unsourced = (t) => unsourcedClaims(t, sourceText).length > 0;
  // قصّة أو خصر أو كسرات لم ترها الصورة (تنورة 2026-09-12 18:29) — تُحذف من كل حقل، لا الوصف وحده.
  const cut = (t) => dropUnseenCut(t, { notes, sourceText, name });
  const unseenCut = (t) => unseenCutPhrases(t, notes, sourceText).length > 0;
  const cw = parsed.copywriting || (parsed.copywriting = {});
  const seo = parsed.seo || (parsed.seo = {});

  cw.description = fixSizeChartClosing(withSizeChartLine(cut(polishProse(cw.description, ctx)), name), { name, category, sourceText });
  cw.excerpt = cut(polishProse(cw.excerpt, ctx)).slice(0, 250);
  cw.whatsapp = cut(polishProse(cw.whatsapp, ctx));
  // «يا هلا! إطلالة رسمية. وش رايك فيها؟» — بقي تحية وسؤالاً بعد حذف الأحكام: يُبنى من النبذة بدل رسالة فارغة.
  const whatsappBody = cw.whatsapp.replace(/(?<!\p{L})(?:يا[ \t]+هلا|هلا|أهلاً|اهلا|مرحبا|وش[ \t]+رايك[ \t]+فيها|وش[ \t]+رأيك[ \t]+فيها|إطلالة[ \t]+رسمية)(?!\p{L})/gu, "");
  if (words(whatsappBody.replace(/[^\p{L}\s]/gu, " ")) < 6 && words(cw.excerpt) >= 6) cw.whatsapp = cw.excerpt;
  if (typeof cw.objectionKiller === "string") cw.objectionKiller = polishProse(cw.objectionKiller, ctx);
  if (typeof cw.callToAction === "string" && unsourced(cw.callToAction)) cw.callToAction = "";
  cw.highlights = (Array.isArray(cw.highlights) ? cw.highlights : [])
    // «اللون البنفسجي يلفت النظر في السهرات» — حذف التعبير يترك «اللون البنفسجي في السهرات»: النقطة كلها مدح.
    .filter((h) => typeof h === "string" && !claimsOtherItem(h, name, sourceText) && !SALES_CTA.test(h) && !unsourced(h) && !hasPraiseIdiom(h, sourceText))
    .map((h) => cut(polishShort(h, ctx)))
    .filter((h) => words(h) >= MIN_HIGHLIGHT_WORDS);
  // نقطة لا تضيف كلمة خارج العنوان واسم المنتج («تنورة ميدي سوداء بكسرات عريضة») تكرار لا ميزة. تلخيص جملة
  // الوصف مسموح: النقاط تُقرأ وحدها على صفحة سلة («سوار فولاذي بثلاثة صفوف»).
  const known = new Set([seo.title, name].flatMap((t) => [...bareWords(t)]));
  cw.highlights = cw.highlights.filter((h) => [...bareWords(h)].some((w) => !known.has(w)));

  // سؤال يدّعي قطعة مرفقة يُحذف بسؤاله وجوابه: جواب «نعم مرفق بها بلوزة» كذب على العميلة.
  parsed.faqs = (Array.isArray(parsed.faqs) ? parsed.faqs : [])
    // سؤال جوابه ادعاء غير مسند («مقاومة للماء؟ نعم…») يُحذف كاملاً: حذف الجملة يترك سؤالاً بلا جواب.
    .filter((f) => f && !claimsOtherItem(`${f.q || ""} ${f.a || ""}`, name, sourceText) && !unsourced(`${f.q || ""} ${f.a || ""}`) && !unseenCut(`${f.q || ""} ${f.a || ""}`))
    .map((f) => ({ ...f, q: polishShort(f.q, ctx), a: polishProse(f.a, ctx) }))
    // جواب من كلمة أو ثلاث بلا رقم («اللون أسود.») يعيد مواصفة لا يجيب سؤالاً؛ «40 ملم.» معلومة تبقى.
    .filter((f) => f.q && f.a && (words(f.a) >= 4 || /[\d٠-٩]/.test(f.a)));

  seo.title = cut(polishShort(seo.title, ctx)) || String(name || "").trim();
  seo.seoTitle = cut(polishShort(seo.seoTitle, ctx)) || seo.title;
  seo.metaDescription = trimMetaRepeat(cut(polishProse(seo.metaDescription, ctx)));
  // ميتا فارغة أو مبتورة بعد التنظيف (عباية نص بشت 2026-09-13): تُبنى من جمل الوصف المنظّف حتى ١٦٠ حرفاً — لا حقل فارغ.
  if (words(seo.metaDescription) < 8) {
    const meta = splitSentencesKeep(cw.description.replace(/\n+/g, " ")).map((x) => x.s.trim()).filter(Boolean)
      .reduce((acc, x) => (!acc ? x : `${acc} ${x}`.length <= 160 ? `${acc} ${x}` : acc), "");
    if (words(meta) >= 8) seo.metaDescription = meta.length <= 160 ? meta : meta.slice(0, 160).replace(/\s+\S*$/u, "");
  }
  if (seo.jsonLdSchema && typeof seo.jsonLdSchema === "object") seo.jsonLdSchema.description = seo.metaDescription;
  if (typeof seo.focusKeyword === "string") seo.focusKeyword = polishShort(seo.focusKeyword, ctx) || String(name || "").trim();
  if (Array.isArray(seo.lsiKeywords)) seo.lsiKeywords = [...new Set(seo.lsiKeywords.filter((k) => !unsourced(k) && !unseenCut(k)).map((k) => polishShort(k, ctx)).filter(Boolean))];

  if (typeof parsed.imageAlt === "string") parsed.imageAlt = cut(polishShort(parsed.imageAlt, ctx)) || String(name || "").trim();
  // SEO-20 (قائمة الفحص القديمة المنقّحة): وسوم بلا تكرار بعد تطبيع الحروف (ة/ه، أ/ا، ى/ي).
  if (Array.isArray(parsed.tags)) {
    const tagKey = (t) => t.replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
    const seenTags = new Set();
    // «بلايز نسائية» وسماً لفستان (تصنيف المتجر، 2026-09-13): وسم يسمّي قطعة أخرى يضلّل البحث.
    parsed.tags = parsed.tags.filter((t) => !unsourced(t) && !unseenCut(t) && !propItemIn(String(t), name)).map((t) => polishShort(t, ctx)).filter((t) => t && !BARE_ADJ_TAG.test(t) && !seenTags.has(tagKey(t)) && seenTags.add(tagKey(t)));
  }
  dropUnsourcedGender(parsed, `${sourceText || ""} ${category || ""} ${name || ""}`);
  if (Array.isArray(parsed.specsTable)) {
    parsed.specsTable = parsed.specsTable
      .map((r) => ({ ...r, key: polishShort(r?.key, { ...ctx, keepLabels: true }), value: polishShort(r?.value, ctx) }))
      // مواصفة قطعة أخرى: «لون العباية: متعدد الألوان» بصفحة تنورة (2026-09-13). «حزام الكتف» لحقيبة جزء منها ويبقى.
      .filter((r) => r.key && r.value && !unsourced(`${r.key} ${r.value}`) && !unseenCut(`${r.key} ${r.value}`) && !propItemIn(r.key.replace(/^(?:لون|نوع|تصميم|شكل|مقاس|خامة|قماش|طول)[ \t]+/u, ""), name));
  }
  // مناسبة لم يذكرها التاجر (معيار ٦.٢، 2026-09-15) — آخر خطوة كي لا تعيدها تصحيحات الحقول أعلاه.
  return stripUnsourcedOccasions(parsed, { sourceText, name });
}

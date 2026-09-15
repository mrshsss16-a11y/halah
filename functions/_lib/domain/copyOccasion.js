// المناسبة والاستخدام والموسم من بيانات التاجر وحدها (معيار COPY_STANDARD ٦.٢، 2026-09-15).
//
// الكاتب كان يشتق المناسبة من «الطابع العام» للصورة: «يناسب الإطلالات النهارية» لفستان كاروهات، و«قصة A بطول
// ميدي للإطلالات اليومية» بنقطة — ادعاء استخدام لم يقله التاجر. القاعدة: عبارة مناسبة أو استخدام أو موسم تُنشر
// فقط إن ورد جذرها بنص التاجر (الاسم، المزايا، الوصف الحالي، الخيارات). وإلا تُحذف بعبارتها أو مقطعها.
// يُطبَّق بعد polishPage وبعد applyVisionFacts (usageClause يقصّ جملاً ولا يولّد مناسبة، لكن الترتيب يضمن ذلك).
import { splitSentencesKeep, joinSentences } from "./copyPhrases.js";

const T = "[\\u064B-\\u0652]*";
const normAr = (t) => String(t || "").replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
const loose = (w) => [...w].map((ch) => `${{ "ا": "[اأإآ]", "ه": "[هة]", "ي": "[يى]" }[ch] || ch}${T}`).join("");

// كل عائلة: صيغ الكلمة (مطبّعة) وجذور تكفي إحداها بنص التاجر لإباحتها.
const FAMILIES = [
  { forms: ["نهاريه", "نهاري", "نهارا"], roots: ["نهار"] },
  { forms: ["يوميه", "يومي", "يوميا"], roots: ["يومي"] },
  { forms: ["مسائيه", "مسائي", "مساء"], roots: ["مسائ", "مساء"] },
  { forms: ["سهرات", "سهره"], roots: ["سهر"] },
  { forms: ["مناسبات"], roots: ["مناسبات"] },
  { forms: ["دوام"], roots: ["دوام"] },
  { forms: ["صيفيه", "صيفي", "صيف"], roots: ["صيف"] },
  { forms: ["شتويه", "شتوي", "شتاء"], roots: ["شتوي", "شتاء", "شتا"] },
  // «عمل» بلا «ال/ل» قد تكون «عمل يدوي» — لا تُعد مناسبة.
  { forms: ["(?<=ال|ل)عمل"], roots: ["العمل", "للعمل"], raw: true },
  { forms: ["حفلات", "حفله", "حفل"], roots: ["حفل"] },
  { forms: ["كاجوال"], roots: ["كاجوال"] }
];
const sourced = (root, src) => new RegExp(`(?<!\\p{L})(?:و|ب|ل|ف)?(?:ال|لل)?${root}`, "u").test(src);
function termFor(sourceText) {
  const src = normAr(sourceText);
  const forms = FAMILIES.filter((f) => !f.roots.some((r) => sourced(r, src))).flatMap((f) => f.forms.map((w) => (f.raw ? w : loose(w))));
  return forms.length ? `(?<!\\p{L})(?:و)?(?:ب|ل|ف|ك)?(?:ال|ل)?(?:${forms.join("|")})(?!\\p{L})` : null;
}
// اسم يُسند إليه الاستخدام: «الإطلالات النهارية»، «للاستخدام اليومي»، «أجواء صيفية».
const HEAD = "(?:و)?(?:ب|ل|ف)?(?:ال|ل)?(?:[إا]طلال(?:ة|ه|ات)|استخدام|[أا]جواء|[أا]وقات|[أا]يام|مشاوير|طلعات|لبس|ارتداء|تنسيقات|مناسب(?:ة|ه))";
const VERB = "(?:و)?(?:مناسب(?:ة|ه)?|ملائم(?:ة|ه)?|(?:ي|ت)(?:ناسب|صلح))";
const phraseRe = (TERM) => new RegExp(`[ \\t]*(?:${VERB}[ \\t]+)?(?:${HEAD}[ \\t]+)?${TERM}(?:[ \\t]+(?:(?:و|[أا]و)[ \\t]*)?(?:${TERM}|(?:و)?(?:ال)?(?:غير[ \\t]+)?(?:ال)?رسمي(?:ة|ه)?|(?:ال)?خاص(?:ة|ه)))*` +
  // «للدوام والزيارات العائلية»: المعطوف المعرّف بعد المناسبة يُحذف معها وإلا بقي «واسع والزيارات» (2026-09-15).
  `(?:[ \\t]+وال\\p{L}+(?:[ \\t]+ال\\p{L}+)?)?`, "gu");
// مقطع يبدأ بفعل استخدام أو تلبيس يُحذف كله: «يناسب الإطلالات النهارية»، «تُلبس في الدوام والزيارات».
const USAGE_HEAD = /^(?:و|ف)?(?:(?:ي|ت)?ناسب|مناسب|ملائم|(?:ي|ت)لبس|(?:ي|ت)رتدي|(?:ي|ت)ستخدم|(?:ي|ت)صلح|خيار|مثالي|اختيار|لل?استخدام|لل?اطلال|في[ \t]+(?:ال)?(?:دوام|سهر|مناسبات|حفل|عمل|صيف|شتاء)|لل?(?:دوام|سهر|مناسبات|حفل|عمل))/u;

const tidy = (t) => t.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+(?<!\p{L})و(?=[ \t]*$)/u, "").replace(/[ \t]+([،؛.!؟])/gu, "$1").trim();

/** مقطع واحد (بين الفواصل): يُحذف كله إن بدأ بفعل استخدام، وإلا تُحذف عبارة المناسبة وحدها. */
function cleanClause(clause, TERM, minWords = 3) {
  if (!new RegExp(TERM, "u").test(clause)) return clause;
  // «تُلبس في المناسبات الرسمية ويمكن تنسيقها مع بلوزة بيضاء» (أرشيف prod-184): المعطوف بفعل مستقل يُفحص وحده،
  // وإلا سقط التنسيق المسمّى مع المناسبة.
  const subs = clause.split(/\s+(?=و(?:يمكن|تقدر|(?:ي|ت)\p{L}{2,}))/u);
  const kept = subs.map((sub) => {
    if (!new RegExp(TERM, "u").test(sub)) return sub;
    if (USAGE_HEAD.test(normAr(sub.trim()))) return "";
    // «هذا الفستان مناسب للمناسبات النهارية» ⇒ «هذا الفستان» بقية بلا خبر: أقل من ثلاث كلمات تُحذف.
    const out = tidy(sub.replace(phraseRe(TERM), ""));
    return out.split(/\s+/).filter(Boolean).length < minWords ? "" : out;
  }).filter((s) => s.trim());
  if (!kept.length) return "";
  if (kept[0] !== subs[0]) kept[0] = kept[0].replace(/^و(?=(?:يمكن|تقدر|(?:ي|ت)\p{L}{2,}))/u, "");
  return kept.join(" ");
}

/**
 * نص قصير أو جملة: عبارات المناسبة غير المسندة تُحذف بمقاطعها، بلا «،» أو «و» معلّقة.
 * short: وسم أو عنوان أو نقطة — بلا حدّ أدنى للكلمات («عبايات يومية» ⇒ «عبايات»، لا حذف الوسم كله).
 */
export function dropUnsourcedOccasions(text, sourceText = "", { short = false } = {}) {
  const t = String(text || "");
  const TERM = termFor(sourceText);
  if (!TERM || !new RegExp(TERM, "u").test(t)) return t;
  return joinSentences(splitSentencesKeep(t).map(({ s, p }) => {
    const end = (s.match(/[.!؟]+$/u) || [""])[0];
    const parts = s.slice(0, s.length - end.length).split(/[ \t]*([،؛])[ \t]*/u);
    const kept = [];
    for (let i = 0; i < parts.length; i += 2) {
      const c = cleanClause(parts[i], TERM, short ? 1 : 3);
      if (c.trim()) kept.push({ c, sep: parts[i - 1] || "،" });
    }
    if (!kept.length) return { s: "", p };
    // «و» العطف تُحذف فقط إن سقط المقطع الأول قبلها؛ لا «ف» أبداً («فستان» صارت «ستان»).
    if (kept[0].c !== parts[0]) kept[0].c = kept[0].c.replace(/^و(?=[تيبل]\p{L}{2,})/u, "");
    return { s: `${kept.map((k, i) => (i ? `${k.sep} ${k.c}` : k.c)).join("")}${end}`, p };
  }));
}

const words = (t) => String(t || "").split(/\s+/).filter(Boolean).length;

/** كل حقل منشور: الوصف والنبذة والواتساب والنقاط والأسئلة والعنوان والميتا والوسوم والمواصفات. */
export function stripUnsourcedOccasions(parsed, { sourceText = "", name = "" } = {}) {
  const TERM = termFor(sourceText);
  if (!parsed || !TERM) return parsed;
  const has = (t) => typeof t === "string" && new RegExp(TERM, "u").test(t);
  const clean = (t) => (has(t) ? dropUnsourcedOccasions(t, sourceText) : t);
  const cleanShort = (t) => (has(t) ? dropUnsourcedOccasions(t, sourceText, { short: true }) : t);
  const cw = parsed.copywriting || (parsed.copywriting = {});
  const seo = parsed.seo || (parsed.seo = {});
  for (const k of ["description", "excerpt", "whatsapp"]) if (typeof cw[k] === "string") cw[k] = clean(cw[k]);
  if (Array.isArray(cw.highlights)) cw.highlights = cw.highlights.map(cleanShort).filter((h) => typeof h !== "string" || words(h) >= 3);
  // سؤال عن المناسبة («هل يناسب السهرات؟») يُحذف بجوابه: حذف عبارته يترك سؤالاً بلا معنى.
  if (Array.isArray(parsed.faqs)) {
    parsed.faqs = parsed.faqs.filter((f) => f && !has(f.q)).map((f) => ({ ...f, a: clean(f.a) }))
      .filter((f) => words(f.a) >= 4 || /[\d٠-٩]/.test(String(f.a || "")));
  }
  if (has(seo.title)) seo.title = cleanShort(seo.title) || String(name || "").trim();
  if (has(seo.seoTitle)) seo.seoTitle = cleanShort(seo.seoTitle) || seo.title;
  if (has(seo.metaDescription)) {
    seo.metaDescription = clean(seo.metaDescription);
    // ميتا صارت قصيرة بعد الحذف: تُبنى من جمل الوصف المنظّف حتى ١٦٠ حرفاً، كما يفعل polishPage.
    if (words(seo.metaDescription) < 8) {
      const meta = splitSentencesKeep(String(cw.description || "").replace(/\n+/g, " ")).map((x) => x.s)
        .reduce((acc, x) => (!acc ? x : `${acc} ${x}`.length <= 160 ? `${acc} ${x}` : acc), "");
      if (words(meta) >= 8) seo.metaDescription = meta.length <= 160 ? meta : meta.slice(0, 160).replace(/\s+\S*$/u, "");
    }
    if (seo.jsonLdSchema && typeof seo.jsonLdSchema === "object") seo.jsonLdSchema.description = seo.metaDescription;
  }
  if (has(parsed.imageAlt)) parsed.imageAlt = cleanShort(parsed.imageAlt) || String(name || "").trim();
  if (Array.isArray(parsed.tags)) parsed.tags = [...new Set(parsed.tags.map(cleanShort).filter(Boolean))];
  if (Array.isArray(parsed.specsTable)) parsed.specsTable = parsed.specsTable.map((r) => (r && has(r.value) ? { ...r, value: cleanShort(r.value) } : r)).filter((r) => !r || String(r.value || "").trim());
  return parsed;
}

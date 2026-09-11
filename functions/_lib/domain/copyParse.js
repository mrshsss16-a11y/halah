// تحليل مخرَج نموذج الوصف وتطبيعه إلى الكائن الذي يُنشر على صفحة المنتج.
// نُقل من `api/copy.js` بالمرحلة ٤ (ARCHITECTURE §٢) بلا تغيير سلوكي —
// انتزاع الـJSON نفسه صار بـ`ai/parseModelJson.js` ويشترك فيه `chat.js`.
import { extractBalancedJson } from "../ai/parseModelJson.js";
import { stripJudgments, splitSentencesKeep, joinSentences } from "./copyPhrases.js";

/**
 * خطأ مصنَّف: تعذّر انتزاع JSON من مخرج النموذج بعد إعادة محاولة واحدة.
 * وجوده هو الفرق بين "فشل التوليد" و"نشر مخرج النموذج الخام كوصف منتج".
 */
export class CopyParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "CopyParseError";
    this.code = "COPY_PARSE_FAILED";
  }
}
// قصّ عند حدّ كلمة: العنوان المقصوص وسط الكلمة ("عباية سوداء بقص") يُنشر
// كما هو على صفحة المنتج ويُقرأ خطأً إملائياً لا اختصاراً.
function truncateAtWord(text, max, minRatio = 0.6) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * minRatio ? cut.slice(0, lastSpace) : cut).trim();
}

// slug احتياطي مطبَّع: بلا محارف تكسر الرابط، بلا شرطات متتالية أو طرفية.
export function fallbackSlug(name) {
  return String(name || "")
    .trim()
    .replace(/[ـ]/g, "")            // تطويل
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")  // أي فاصل ⇒ شرطة واحدة (الحركات جزء من الحرف)
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
}

/**
 * A7 — الميتا ديسكربشن حدّها المعلن بالبرومبت ١٢٠-١٦٠ حرفاً، ولم يكن أحد
 * يفرض الحد الأدنى: النموذج يرجّع ٤٠ حرفاً فيُنشر كما هو. هنا: لو أقصر من
 * ١٢٠ نكمله من النبذة (نص حقيقي للمنتج نفسه، لا حشو مخترع) بحد ١٦٠.
 */
export function buildMetaDescription(metaRaw, excerpt) {
  let meta = String(metaRaw || "").trim().replace(/\s+/g, " ");
  const filler = String(excerpt || "").trim().replace(/\s+/g, " ");
  if (meta.length < 120 && filler) {
    const joined = meta ? (filler.startsWith(meta) ? filler : `${meta} ${filler}`) : filler;
    meta = joined.trim();
  }
  // 0.9: القصّ عند حد كلمة يجب ألا يهبط بالميتا تحت الحد الأدنى (١٢٠ من ١٦٠).
  return truncateAtWord(meta, 160, 0.9);
}

// A5 — بوابة لغة ملاحظات الرؤية. الشرط الوحيد: وجود حرف عربي فعلي.
const ARABIC_LETTER_RE = /[ء-ي٠-٩ە-ۿ]/;

/** يعيد الملاحظات إن كانت عربية، وإلا `null` (تُهمل كلياً). */
export function acceptArabicVisionNotes(notes) {
  const text = String(notes || "").trim();
  if (!text) return null;
  return ARABIC_LETTER_RE.test(text) ? text : null;
}

/**
 * تصنيف ملاحظات الرؤية بدل إهدارها.
 *
 * السلوك السابق (A5) كان يُهمل أي مخرج بلا حرف عربي بالكامل. النية صحيحة —
 * مصطلح إنجليزي داخل وصف عربي عيب حقيقي — لكن **الأثر كان أسوأ من المرض**:
 * رُصد 2026-09-09 وصفٌ نُشر على متجر حي يقول "مصنوع من مواد عالية الجودة"
 * لفستان لم يره النموذج إطلاقاً. إهدار الملاحظات ترك النموذج بلا أي حقيقة،
 * فاخترع بدل أن يصمت.
 *
 * الملاحظات الإنجليزية **محتواها صحيح، لغتها فقط خاطئة** — تُمرَّر مع علامة،
 * والبرومبت يُلزم بترجمة المعنى وحظر نقل أي مصطلح إنجليزي حرفياً.
 *
 * @returns {{ text: string, language: "ar"|"en" } | null}
 */
export function classifyVisionNotes(notes) {
  const text = String(notes || "").trim();
  if (!text) return null;
  return { text, language: ARABIC_LETTER_RE.test(text) ? "ar" : "en" };
}
/**
 * A4 — يرجّع الكائن المنظَّم، أو **يرمي** `CopyParseError`.
 *
 * السلوك السابق عند فشل التحليل كان: خذ مخرج النموذج الخام كما هو واجعله
 * `description` و`excerpt` و`whatsapp` و`metaDescription`. أي أن اعتذاراً
 * بالإنجليزي أو JSON نصف مكتوب كان يُنشر على صفحة منتج التاجر بسلة كوصف.
 * الفشل الآن فشلٌ صريح — المستدعي يعيد المحاولة مرة ثم يرمي (§١١).
 */
export function parseSeoResponse(raw, name, price) {
  const source = typeof raw === "string" ? raw : String(raw ?? "");
  const jsonString = extractBalancedJson(source);

  if (jsonString) {
    // "تنظيف الاقتباسات" السابق (`replace(/:\s*"([^"]*)"/g, …)`) كان مدمِّراً:
    // يعيد تهريب علامات **مهرَّبة أصلاً** فيحوّل `\"` إلى `\\"` ويكسر JSON
    // صالحاً. أُزيل بالكامل — JSON.parse وحده هو الحَكَم.
    let p = null;
    try {
      p = JSON.parse(jsonString);
    } catch {
      p = null;
    }
    if (p) {
      if (p.copywriting && (p.copywriting.description || p.copywriting.excerpt)) {
        const title = truncateAtWord(p.seo?.title || name, 60);
        const excerptRaw = String(p.copywriting.excerpt || p.copywriting.description || "");
        const metaDesc = buildMetaDescription(p.seo?.metaDescription, excerptRaw);

        // Schema.org JSON-LD — مرجعي للتاجر فقط (سلة تولّد بنيتها بنفسها على صفحة
        // المنتج). السعر يظهر فقط إن أُدخل، ولا ادعاء توفر: لا نعرف المخزون.
        const jsonLdSchema = {
          "@context": "https://schema.org/",
          "@type": "Product",
          "name": title,
          "description": metaDesc,
          ...(price ? { "offers": { "@type": "Offer", "priceCurrency": "SAR", "price": String(price) } } : {})
        };

        return {
          seo: {
            title,
            seoTitle: truncateAtWord(p.seo?.seoTitle || `${title} | اشتري الآن`, 65),
            slug: (String(p.seo?.slug || "").trim() && fallbackSlug(p.seo.slug)) || fallbackSlug(name),
            metaDescription: metaDesc,
            focusKeyword: String(p.seo?.focusKeyword || name),
            lsiKeywords: Array.isArray(p.seo?.lsiKeywords) ? p.seo.lsiKeywords.map(String) : [],
            jsonLdSchema
          },
          copywriting: {
            excerpt: String(p.copywriting.excerpt || metaDesc).slice(0, 250),
            description: String(p.copywriting.description || metaDesc).trim(),
            highlights: Array.isArray(p.copywriting.highlights) ? p.copywriting.highlights.map(String) : [],
            // لا قيم افتراضية مخترعة (ضمان، مدة توصيل…) — غياب الحقل يبقى فارغاً (§11).
            objectionKiller: String(p.copywriting.objectionKiller || "").trim(),
            whatsapp: String(p.copywriting.whatsapp || p.copywriting.excerpt || p.copywriting.description).trim(),
            callToAction: String(p.copywriting.callToAction || "اطلبه الآن").trim()
          },
          specsTable: Array.isArray(p.specsTable) ? p.specsTable.filter((r) => r && r.key && r.value) : [],
          faqs: Array.isArray(p.faqs) ? p.faqs : [],
          imageAlt: String(p.imageAlt || `${name} في السعودية`),
          tags: Array.isArray(p.tags) ? p.tags.map((t) => String(t).replace(/^#/, "").trim()) : []
        };
      }
    }
  }

  // لا سقوط لنص خام: مخرج غير قابل للتحليل ليس وصف منتج. الرمي هو الطريقة
  // الوحيدة التي تمنع نشره على صفحة التاجر بسلة (A4 · §١١).
  throw new CopyParseError("model output is not parseable product-copy JSON");
}

// ── بوابة جودة الوصف (2026-09-11) ─────────────────────────────────────────
//
// رصده المالك على وصف حقيقي بمتجر المراجعة: «هذي تنورة نسائية طويلة، لونها
// أسود جميل. … السعر: 83 ريال.» — ثلاثة عيوب لا يمسكها تحليل JSON: افتتاحية
// إشارية («هذي/هذه/هذا»)، والسعر داخل نص الوصف (يتغيّر بالمتجر ويبقى النص
// كاذباً)، ووصف قصير عامّ رغم توفّر ملاحظات صورة. الفحص هنا حتمي ورخيص، ولا
// يعتمد على أن النموذج «فهم» القاعدة — يُعاد التوليد مرة بتعليمة تسمّي العيب،
// ثم يُنظَّف النص بحدّ أدنى مضمون لو أصرّ النموذج.

/** افتتاحيات إشارية/تعريفية لا يبدأ بها وصف منتج على صفحة متجر. */
// لا `\b` هنا: حدّ الكلمة بـJavaScript لاتيني فقط ولا يرى الحروف العربية —
// فكان «هذي تنورة» يمرّ. الحدّ صريح: مسافة أو نهاية أو علامة ترقيم.
const BAD_OPENERS = /^(هذي|هذه|هذا|هاذي|هاذا|هذول|هذيك|هذاك|منتجنا|منتجك|إليك|اليك|نقدم لك|نقدّم لك)(?=[\s،,:.!؟]|$)/;
/** ذكر سعر داخل النثر: رقم مع ريال/ر.س/SAR، أو كلمة «السعر». */
const PRICE_IN_PROSE = /(السعر|بسعر|سعره|سعرها)\s*[:：]?\s*[\d٠-٩]|[\d٠-٩][\d٠-٩.,]*\s*(ريال|ر\.?س\.?|SAR|﷼)/;
// ٣٥ = حد مكتبة الأوصاف السعودية المنقّحة (أمثلة الأسلوب ٣٥–٤٧ كلمة). حدّ أعلى
// يجعل كل وصف يقلّد الأمثلة يفشل ويُعاد توليده. «هذي تنورة…» الأصلي يبقى ممسوكاً
// بالافتتاحية والسعر لا بالطول.
const MIN_WORDS_WITH_VISION = 35;
/** معقوف بالمخرج = عنصر نائب منقول من أمثلة الأسلوب ({الخامة}) — لا يصل صفحة متجر. */
const PLACEHOLDER = /[{}]/;
/**
 * ادعاءات محظورة — من مكتبة أوصاف المنتجات السعودية التي زوّدها المالك
 * (docs/sources/…xlsx، ورقة «نواهي_الوصف» N001/N003/N010 وورقة «مقومات_الوصف»
 * C005): ذكر آلية التحليل، أحكام ملاءمة الجسد، الأصالة/الضمان بلا مصدر،
 * والندرة المصطنعة. كلها تصل عميلاً كوعد لا يملكه التاجر.
 */
const PROHIBITED_CLAIMS = /(حلل(?:ت|نا) الصورة|بعد تحليل الصورة|من خلال (?:تحليل )?الصورة|بناءً على الصورة|يناسب (?:كل|جميع) الأجسام|يناسب (?:كل|جميع) أشكال الجسم|يخفي (?:العيوب|عيوب الجسم)|منتج أصلي|أصلي ١٠٠|أصلي 100|مضمون(?:ة)? ١٠٠|مضمون(?:ة)? 100|الكمية محدودة|لفترة محدودة|قبل نفاد الكمية|سارع(?:ي)? بالطلب|آخر قطعة|أرخص سعر|أرخص من السوق|لا تفو[ّ]?ت(?:ي)? الفرصة|نضمن لك|كل العملاء يحبونه|أكيد يناسبك|يوصل(?:ك)? (?:بكرة|غداً|غدا|اليوم)|توصيل (?:سريع )?خلال)/;

/**
 * خامة/معدن/حجر بلا مصدر — من قاعدة معرفة الدعم السعودية (docs/sources/
 * saudi_white_arabic_support_marketing_kb.xlsx، ورقة «الممنوعات» F005/F006) ومكتبة
 * الأوصاف (I004/I008): الصورة لا تثبت المادة. الكلمة مسموحة **فقط** إن وردت
 * ببيانات التاجر (الاسم/المزايا/الوصف الحالي/الخيارات) — ملاحظات الصورة ليست مصدراً.
 * «ذهبي»/«فضي»/«حريري» ألوان وملمس لا مواد، فحدّ الكلمة يستثنيها.
 */
const SOURCED_MATERIALS = ["الماس", "حرير", "ذهب", "فضه", "جلد طبيعي", "لولو", "كشمير", "عيار", "زركون"];
const normAr = (t) => String(t || "").replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ؤ/g, "و");
function unsourcedMaterial(text, sourceText) {
  const body = normAr(text);
  const src = normAr(sourceText);
  return SOURCED_MATERIALS.find((m) =>
    new RegExp(`(?<!\\p{L})(?:و|ب|ف|ل|ك)?(?:ال)?${m}(?!\\p{L})`, "u").test(body) && !src.includes(m)
  ) || null;
}

/**
 * يرجّع قائمة عيوب الوصف (فارغة = مقبول). كل عيب يحمل رمزاً ثابتاً للاختبار
 * والسجل، ونصاً عربياً يُلقَّم للنموذج بإعادة المحاولة.
 */
export function descriptionQualityIssues(copywriting, { hasVision = false, sourceText, productName } = {}) {
  const issues = [];
  const desc = String(copywriting?.description || "").trim();
  const excerpt = String(copywriting?.excerpt || "").trim();
  const wa = String(copywriting?.whatsapp || "").trim();
  if (BAD_OPENERS.test(desc)) {
    issues.push({ code: "BAD_OPENER", text: "الوصف يبدأ بافتتاحية إشارية (هذي/هذه/منتجنا…) — ابدئي باسم المنتج أو بميزته المرئية." });
  }
  if (PRICE_IN_PROSE.test(desc) || PRICE_IN_PROSE.test(excerpt) || PRICE_IN_PROSE.test(wa)) {
    issues.push({ code: "PRICE_IN_PROSE", text: "نص الوصف/النبذة/الواتساب يذكر سعراً — المتجر يعرض السعر بنفسه، والرقم يتغيّر ويبقى النص كاذباً. احذفي أي سعر." });
  }
  if ([desc, excerpt, wa].some((t) => PLACEHOLDER.test(t))) {
    issues.push({ code: "PLACEHOLDER_LEAK", text: "النص يحوي عنصراً نائباً بين معقوفين (مثل {الخامة}) منقولاً من أمثلة الأسلوب. اذكري الحقيقة فقط إن وردت ببيانات التاجر، وإلا احذفي الجملة كاملة. ممنوع أي معقوف بالمخرج." });
  }
  const claim = [desc, excerpt, wa].map((t) => t.match(PROHIBITED_CLAIMS)?.[0]).find(Boolean);
  if (claim) {
    issues.push({ code: "PROHIBITED_CLAIM", text: `النص يحمل ادعاءً محظوراً («${claim}»): لا ذكر لآلية تحليل الصورة، ولا حكم على ملاءمة الجسد، ولا أصالة أو ضمان بلا مصدر، ولا ندرة مصطنعة. احذفيه واكتفي بالمرئي والمثبت.` });
  }
  // بلا sourceText (نداء قديم/اختبار) لا فحص مادة — لا نحكم بلا معرفة المصدر.
  const material = sourceText === undefined ? null : [desc, excerpt, wa].map((t) => unsourcedMaterial(t, sourceText)).find(Boolean);
  if (material) {
    issues.push({ code: "UNSOURCED_MATERIAL", text: `النص يذكر خامة أو معدناً أو حجراً («${material}») لم يرد في بيانات التاجر — الصورة لا تثبت المادة. احذفيه وصفي المظهر فقط («لون ذهبي» لا «ذهب»، «لمعة ناعمة» لا «حرير»).` });
  }
  // قطعة تلبسها العارضة وُصفت كأنها المنتج («التنورة مصنوعة من طبقات لونية» بوصف بلوزة) —
  // رُصد على متجر المراجعة بالنسخة الحالية 2026-09-11.
  const prop = productName ? splitSentences(desc).map((s) => propItemIn(s, productName)).find(Boolean) : null;
  if (prop) {
    issues.push({ code: "PROP_ITEM", text: `الوصف يصف «${prop}» كأنها جزء من المنتج، وهي قطعة تلبسها العارضة في الصورة. اكتبي عن «${productName}» وحده، واذكري غيره كتنسيق مقترح فقط («تُنسَّق مع ${prop}…»).` });
  }
  const words = desc ? desc.split(/\s+/).filter(Boolean).length : 0;
  if (hasVision && words < MIN_WORDS_WITH_VISION) {
    issues.push({ code: "TOO_SHORT", text: `الوصف ${words} كلمة فقط رغم توفّر ملاحظات صورة — اكتبي ٤٠–٨٠ كلمة من المرئيات المذكورة (اللون، القصّة، الطول، التفاصيل) واقتراح استخدام مشتق منها.` });
  }
  return issues;
}

/**
 * تنظيف حتمي بحدّ أدنى حين يُصرّ النموذج بعد إعادة المحاولة: يُسقط الافتتاحية
 * الإشارية ويحذف الجمل التي تذكر سعراً أو ادعاءً محظوراً. لا يخترع نصاً — يحذف فقط.
 */
export function cleanDescription(text, { sourceText, productName } = {}) {
  let t = String(text || "").trim();
  t = t.replace(BAD_OPENERS, "").replace(/^[\s،:,]+/, "");
  // احذف الجملة الحاملة للسعر كاملة (حتى أقرب نقطة/سطر)، لا الرقم وحده.
  t = joinSentences(splitSentencesKeep(t).map((p) => ({ ...p, s: sourceText !== undefined && unsourcedJudgment(p.s, sourceText) ? stripJudgments(p.s) : p.s })).filter(({ s }) => s && !PRICE_IN_PROSE.test(s) && !PROHIBITED_CLAIMS.test(s) && !PLACEHOLDER.test(s) && !MECHANISM_LEAK.test(s) && !(productName && propItemIn(s, productName)) && !(sourceText !== undefined && (unsourcedMaterial(s, sourceText) || unsourcedJudgment(s, sourceText)))));
  return t;
}


// ── حراس الحقول المنشورة الأخرى (2026-09-11) ─────────────────────────────
//
// ما يُنشر على صفحة المنتج بسلة ليس الوصف وحده: `composeDescriptionHtml` يضيف
// النقاط (highlights) والأسئلة الشائعة (faqs)، و`buildSallaProductFields` يرسل
// العنوان والميتا. المخرجات الحقيقية الأربعة التي رفضها التاجر اختلقت في الأسئلة
// الشائعة مدة شحن («تتم شحن الطلبات خلال 3-5 أيام عمل») وطرق دفع وسياسة إرجاع،
// ونقاطاً من كلمة واحدة («مريح»، «انيق») — والحارس لم يكن يفحص إلا الوصف والنبذة
// والواتساب. مراجع سلة يولّد وصفاً ويرى الصفحة كاملة.

/**
 * سياسة متجر لا تعرفها هالة. العبارات محددة عمداً: «شحن» وحدها تُسقط مواصفة
 * حقيقية لشاحن («يدعم الشحن السريع»)، فالمحظور صيغة الوعد لا الكلمة.
 * مسموحة فقط إن وردت ببيانات التاجر (ضمانٌ نصّ عليه التاجر في المزايا مثلاً).
 */
const STORE_POLICY = /(مدة الشحن|الشحن خلال|يتم الشحن|تتم شحن|تتم الشحن|يشحن خلال|يُشحن خلال|شحن مجاني|الشحن مجاني|رسوم الشحن|التوصيل خلال|مدة التوصيل|توصيل مجاني|التوصيل مجاني|الإرجاع|إرجاع|الارجاع|ارجاع|الاسترجاع|استرجاع|الاستبدال|استبدال|طرق الدفع|طريقة الدفع|وسائل الدفع|وسائل دفع|الدفع عند الاستلام|بطاقات الائتمان|بطاقة ائتمان|التحويل البنكي|تحويل بنكي|الضمان|ضمان|تقسيط|تابي|تمارا)/;
/** كشف آلية قراءة الصورة في نص منشور: «لا يوجد حزام مرئي»، «يبدو أن الفستان…». */
const MECHANISM_LEAK = /(غير مرئي|يبدو أن|ملاحظات الصورة|(?<!\p{L})مرئي(?:ة|ه)?(?!\p{L}))/u;
/** أحكام جودة (قاعدة ٥ بالبرومبت) — مسموحة فقط إن وردت ببيانات التاجر. مطبَّعة بـnormAr. */
// «مثالي» أُضيفت 2026-09-11: «هذه البلوزة مثالية للمناسبات» بمخرج حقيقي على متجر المراجعة.
const JUDGMENTS = ["مريح", "انيق", "اناقه", "اناقت", "فاخر", "فخامه", "فخامت", "جمال", "جميل", "متين", "مثالي", "راقي", "عالي الجوده", "جوده عاليه"];
function unsourcedJudgment(text, sourceText) {
  const body = normAr(text);
  const src = normAr(sourceText);
  return JUDGMENTS.find((j) =>
    new RegExp(`(?<!\\p{L})(?:و|ب)?(?:ال)?${j}(?:ه|ا|ها)?(?!\\p{L})`, "u").test(body) && !src.includes(j)
  ) || null;
}
const MIN_HIGHLIGHT_WORDS = 3;
const words = (t) => String(t || "").trim().split(/\s+/).filter(Boolean).length;

function textProblems(text, sourceText) {
  const t = String(text ?? "");
  if (!t.trim()) return [];
  const out = [];
  if (PRICE_IN_PROSE.test(t)) out.push("PRICE_IN_PROSE");
  if (PLACEHOLDER.test(t)) out.push("PLACEHOLDER_LEAK");
  if (PROHIBITED_CLAIMS.test(t)) out.push("PROHIBITED_CLAIM");
  if (MECHANISM_LEAK.test(t)) out.push("MECHANISM_LEAK");
  const policy = t.match(STORE_POLICY)?.[0];
  if (policy && !(sourceText !== undefined && normAr(sourceText).includes(normAr(policy).replace(/^ال/, "")))) out.push("STORE_POLICY");
  if (sourceText !== undefined && unsourcedMaterial(t, sourceText)) out.push("UNSOURCED_MATERIAL");
  if (sourceText !== undefined && unsourcedJudgment(t, sourceText)) out.push("UNSOURCED_JUDGMENT");
  return out;
}

const FIELD_ISSUE_TEXT = {
  PRICE_IN_PROSE: "سعر داخل النص — المتجر يعرض السعر بنفسه",
  PLACEHOLDER_LEAK: "عنصر نائب بين معقوفين",
  PROHIBITED_CLAIM: "ادعاء محظور (ندرة، أصالة بلا مصدر، حكم على الجسد)",
  MECHANISM_LEAK: "كشف لآلية قراءة الصورة («مرئي»، «يبدو أن») — صفي المنتج مباشرة",
  STORE_POLICY: "سياسة متجر لا نعرفها (شحن، توصيل، إرجاع، استبدال، دفع، ضمان) — احذفي أي سؤال أو نقطة عنها",
  UNSOURCED_MATERIAL: "خامة أو معدن أو حجر لم يرد ببيانات التاجر",
  UNSOURCED_JUDGMENT: "حكم جودة بلا مصدر («مريح»، «أنيق»، «فاخر») — صفي التفصيل بدل الحكم",
  THIN_HIGHLIGHT: "نقطة من كلمة أو كلمتين — كل نقطة فائدة ملموسة مرتبطة بتفصيل",
  PROP_ITEM: "نقطة تصف قطعة أخرى تلبسها العارضة لا المنتج نفسه"
};

/**
 * عيوب الحقول المنشورة غير الوصف: النقاط، الأسئلة الشائعة، العنوان، عنوان البحث،
 * الميتا — ومن الوصف نفسه الفحصان الجديدان فقط (كشف الآلية وحكم الجودة)، لأن
 * `descriptionQualityIssues` تغطي بقيته. عيب واحد لكل رمز مع قائمة الحقول.
 */
export function publishedFieldIssues(parsed, { sourceText, productName } = {}) {
  const found = new Map();
  const note = (codes, field) => codes.forEach((c) => {
    if (!found.has(c)) found.set(c, new Set());
    found.get(c).add(field);
  });
  const cw = parsed?.copywriting || {};
  const seo = parsed?.seo || {};
  for (const h of Array.isArray(cw.highlights) ? cw.highlights : []) {
    note(textProblems(h, sourceText), "النقاط");
    if (words(h) < MIN_HIGHLIGHT_WORDS) note(["THIN_HIGHLIGHT"], "النقاط");
    if (productName && propItemIn(h, productName)) note(["PROP_ITEM"], "النقاط");
  }
  for (const f of Array.isArray(parsed?.faqs) ? parsed.faqs : []) {
    note([...textProblems(f?.q, sourceText), ...textProblems(f?.a, sourceText)], "الأسئلة الشائعة");
  }
  note(textProblems(seo.title, sourceText), "العنوان");
  note(textProblems(seo.seoTitle, sourceText), "عنوان البحث");
  note(textProblems(seo.metaDescription, sourceText), "وصف الميتا");
  note(textProblems(cw.description, sourceText).filter((c) => c === "MECHANISM_LEAK" || c === "UNSOURCED_JUDGMENT"), "الوصف");
  return [...found].map(([code, fields]) => ({ code: `FIELD_${code}`, text: `${FIELD_ISSUE_TEXT[code]} (في: ${[...fields].join("، ")})` }));
}

/**
 * تنظيف حتمي للحقول المنشورة حين يُصرّ النموذج: حذف فقط، لا اختراع.
 * نقطة أو سؤال معيب يُحذف كاملاً؛ عنوان معيب يعود لاسم المنتج؛ ميتا معيبة
 * تُعاد بناؤها من النبذة بعد تنظيفها.
 */
export function cleanPublishedFields(parsed, { sourceText, name = "" } = {}) {
  const bad = (t) => textProblems(t, sourceText).length > 0;
  const cw = parsed.copywriting || (parsed.copywriting = {});
  cw.highlights = (Array.isArray(cw.highlights) ? cw.highlights : [])
    .filter((h) => !bad(h) && words(h) >= MIN_HIGHLIGHT_WORDS && !(name && propItemIn(h, name)));
  parsed.faqs = (Array.isArray(parsed.faqs) ? parsed.faqs : [])
    .filter((f) => f && String(f.q || "").trim() && String(f.a || "").trim() && !bad(f.q) && !bad(f.a));
  cw.description = cleanDescription(cw.description, { sourceText, productName: name });
  const seo = parsed.seo || (parsed.seo = {});
  if (bad(seo.title)) seo.title = truncateAtWord(String(name || ""), 60);
  if (bad(seo.seoTitle)) seo.seoTitle = truncateAtWord(seo.title || String(name || ""), 65);
  if (bad(seo.metaDescription)) {
    seo.metaDescription = buildMetaDescription("", cleanDescription(cw.excerpt || cw.description, { sourceText }));
    if (seo.jsonLdSchema) seo.jsonLdSchema.description = seo.metaDescription;
  }
  return parsed;
}


// ── قطع العارضة (2026-09-11) ──────────────────────────────────────────────
//
// صورة المنتج غالباً على عارضة تلبس قطعاً أخرى. مخرج حقيقي بالنسخة الحالية لمنتج
// «بلوزة»: «التنورة مصنوعة من طبقات لونية: أبيض وأزرق فاتح وأزرق غامق» — التنورة
// ليست ما يبيعه التاجر. الفحص محافظ عمداً: نوع المنتج = أول كلمة من اسمه، ولا فحص
// إن لم تكن في القائمة (مسبحة، عطر…)؛ والمحظور جملة **تبدأ** بقطعة أخرى، فعبارة
// التنسيق «تُنسَّق مع تنورة…» مسموحة.
const ITEM_GROUPS = [
  ["فستان", "فساتين"], ["تنوره", "تنانير"], ["بلوزه", "بلايز", "بلوزات"], ["قميص", "قمصان"],
  ["بنطال", "بنطلون", "بناطيل"], ["جاكيت", "جاكت", "جاكيتات"], ["عبايه", "عبايات"],
  ["حذاء", "احذيه", "جزمه", "صندل"], ["حقيبه", "حقائب", "شنطه", "شنط"], ["قبعه"],
  ["نظاره", "نظارات"], ["حزام"], ["طرحه", "حجاب", "شال", "وشاح"], ["قلاده", "سلسال"],
  ["سوار", "اساور"], ["خاتم"], ["اقراط", "حلق"], ["شورت"], ["جينز"], ["كنزه", "سويتر", "هودي"], ["تيشيرت"]
];
function itemGroup(word) {
  const w = normAr(word).replace(/^ال/, "");
  return ITEM_GROUPS.findIndex((g) => g.includes(w));
}
export function splitSentences(text) {
  return String(text || "").split(/(?<=[.!؟\n])\s+/).filter((s) => s.trim());
}
/** اسم القطعة الأخرى إن بدأت بها الجملة، وإلا null. */
export function propItemIn(sentence, productName) {
  const productGroup = itemGroup(String(productName || "").trim().split(/\s+/)[0] || "");
  if (productGroup < 0) return null;
  const first = normAr(sentence).trim().replace(/^[\s،:,\-–—]+/, "").split(/\s+/)[0] || "";
  for (const candidate of [first, first.replace(/^و/, "")]) {
    const g = itemGroup(candidate);
    if (g >= 0) return g !== productGroup ? candidate.replace(/^ال/, "") : null;
  }
  return null;
}

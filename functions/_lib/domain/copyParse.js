// تحليل مخرَج نموذج الوصف وتطبيعه إلى الكائن الذي يُنشر على صفحة المنتج.
// نُقل من `api/copy.js` بالمرحلة ٤ (ARCHITECTURE §٢) بلا تغيير سلوكي —
// انتزاع الـJSON نفسه صار بـ`ai/parseModelJson.js` ويشترك فيه `chat.js`.
import { extractBalancedJson } from "../ai/parseModelJson.js";

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
const MIN_WORDS_WITH_VISION = 45;
/**
 * ادعاءات محظورة — من مكتبة أوصاف المنتجات السعودية التي زوّدها المالك
 * (docs/sources/…xlsx، ورقة «نواهي_الوصف» N001/N003/N010 وورقة «مقومات_الوصف»
 * C005): ذكر آلية التحليل، أحكام ملاءمة الجسد، الأصالة/الضمان بلا مصدر،
 * والندرة المصطنعة. كلها تصل عميلاً كوعد لا يملكه التاجر.
 */
const PROHIBITED_CLAIMS = /(حلل(?:ت|نا) الصورة|بعد تحليل الصورة|من خلال (?:تحليل )?الصورة|بناءً على الصورة|يناسب (?:كل|جميع) الأجسام|يناسب (?:كل|جميع) أشكال الجسم|يخفي (?:العيوب|عيوب الجسم)|منتج أصلي|أصلي ١٠٠|أصلي 100|مضمون(?:ة)? ١٠٠|مضمون(?:ة)? 100|الكمية محدودة|لفترة محدودة|قبل نفاد الكمية|سارع(?:ي)? بالطلب)/;

/**
 * يرجّع قائمة عيوب الوصف (فارغة = مقبول). كل عيب يحمل رمزاً ثابتاً للاختبار
 * والسجل، ونصاً عربياً يُلقَّم للنموذج بإعادة المحاولة.
 */
export function descriptionQualityIssues(copywriting, { hasVision = false } = {}) {
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
  const claim = [desc, excerpt, wa].map((t) => t.match(PROHIBITED_CLAIMS)?.[0]).find(Boolean);
  if (claim) {
    issues.push({ code: "PROHIBITED_CLAIM", text: `النص يحمل ادعاءً محظوراً («${claim}»): لا ذكر لآلية تحليل الصورة، ولا حكم على ملاءمة الجسد، ولا أصالة أو ضمان بلا مصدر، ولا ندرة مصطنعة. احذفيه واكتفي بالمرئي والمثبت.` });
  }
  const words = desc ? desc.split(/\s+/).filter(Boolean).length : 0;
  if (hasVision && words < MIN_WORDS_WITH_VISION) {
    issues.push({ code: "TOO_SHORT", text: `الوصف ${words} كلمة فقط رغم توفّر ملاحظات صورة — اكتبي ٦٠–١٢٠ كلمة من المرئيات المذكورة (اللون، القصّة، الطول، التفاصيل) واقتراح استخدام مشتق منها.` });
  }
  return issues;
}

/**
 * تنظيف حتمي بحدّ أدنى حين يُصرّ النموذج بعد إعادة المحاولة: يُسقط الافتتاحية
 * الإشارية ويحذف الجمل التي تذكر سعراً أو ادعاءً محظوراً. لا يخترع نصاً — يحذف فقط.
 */
export function cleanDescription(text) {
  let t = String(text || "").trim();
  t = t.replace(BAD_OPENERS, "").replace(/^[\s،:,]+/, "");
  // احذف الجملة الحاملة للسعر كاملة (حتى أقرب نقطة/سطر)، لا الرقم وحده.
  t = t.split(/(?<=[.!؟\n])\s+/).filter((s) => !PRICE_IN_PROSE.test(s) && !PROHIBITED_CLAIMS.test(s)).join(" ").trim();
  return t;
}

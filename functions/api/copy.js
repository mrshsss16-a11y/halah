// POST /api/copy
// Elite E-Commerce SEO Copywriting & Schema Engine for Saudi Merchants (Salla / Zid / Trendyol)
// Powered by the "salla-zid-product-copy" Master Skill Rules.
// Generates: Title, SEO Title, Slug, Excerpt, Meta Description, Benefit Description,
// Specs Table, FAQs, Image ALT, Tags, and JSON-LD Product Schema Markup.
import { withApi } from "../_lib/core/respond.js";
import { askWorkersAI, askVisionAI, COPY_MODEL } from "../_lib/ai/gateway.js";
import { PERSONA_SYSTEM_PROMPT } from "../_lib/ai/persona.js";
import { recentCopy, saveCopy } from "../_lib/core/db.js";
import { recallStyleExamples } from "../_lib/ai/memory.js";
import { checkAndConsumeMonthly } from "../_lib/core/meter.js";
import { requireCompletedAccount } from "../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../_lib/core/rateLimit.js";
import { getProfile, profileToPromptBlock } from "../_lib/services/storeProfile.js";
import { taxonomyForCategory, taxonomyForProduct } from "../_lib/ai/productTaxonomy.js";

// نافذة recentCopy مثبّتة على ٥ (docs/PLAN_BULK_SEO.md §٥، المخاطرة ٣):
// الدالة تجلب "الأخيرة" فقط، فعبر دفعة ٢٠٠ منتج تنجرف — منتج ٢٠٠ يقارن نفسه
// بمنتج ١٩٥ لا بمنتج ١. تثبيت النافذة يبقيها أداة "لا تكرري نفس الافتتاحية"
// ولا يسمح لها بأن تصير مرجع الأسلوب؛ المرجع هو بصمة المتجر أدناه.
const RECENT_OPENINGS_WINDOW = 5;

const TONE_LABELS = {
  white: "لهجة بيضاء تسويقية ودودة",
  formal: "فصحى رسمية راقية",
  luxury: "فخامة وحصرية",
  deals: "حماس عروض بدون إلحاح كاذب",
  funny: "خفة دم سعودية لطيفة"
};

function seedKeywords(name, category, extra) {
  const base = new Set();
  (extra || []).forEach((k) => k && base.add(String(k).trim()));
  String(name || "").split(/\s+/).filter((w) => w.length > 2).forEach((w) => base.add(w));
  if (category) base.add(String(category).trim());
  return [...base].slice(0, 6);
}

/**
 * البوابة الوحيدة لحقن البصمة — دالة مصدَّرة عمداً لتكون **مُختبَرة مباشرة**:
 * الفرق بين `draft` و`approved` هنا هو كل ما يفصل "الإنسان قرر" عن "النموذج
 * قرر نيابة عنه" عبر دفعة كاملة. مسودة، أو غياب بصمة، أو صف تالف ⇒ "" ⇒
 * السلوك القديم بلا أي تغيير.
 */
export function approvedProfileBlock(profileRow) {
  return profileRow?.status === "approved" ? profileToPromptBlock(profileRow.profile) : "";
}

/**
 * توجيه تحليل صورة المنتج — **وصف بصري محايد فقط، لا استنتاج**.
 *
 * التوجيه السابق كان يطلب "الخامة" صراحةً وسقفه "جملتين". الخامة لا تُرى
 * بيقين من صورة (شيفون/كريب/ساتان متشابهة بصرياً)، فكان النموذج يخمّنها
 * ويقدّمها كحقيقة، ثم يُحقن التخمين بالبرومبت الرئيسي فيصير ادعاءً بوصف
 * المنتج ⇒ استرجاع وشكوى، ومخالفة مباشرة لقاعدة الصدق (AGENT.md §١١).
 * لذلك: صف ما تراه فقط، واسكت عند الشك.
 */
export const VISION_PROMPT = [
  "صف هذا المنتج وصفاً بصرياً محايداً، بالعربي، في ٣ إلى ٥ جمل قصيرة.",
  "",
  "قواعد إلزامية:",
  "- صف ما تراه في الصورة فقط. ممنوع الاستنتاج أو الافتراض أو إكمال الناقص.",
  "- اذكر صراحةً كل ما هو مرئي بيقين ولا يحتاج تخميناً: اللون (والألوان الثانوية إن وُجدت)، والقصّة/السيلويت، والطول، والأكمام، وأي تفصيل بارز واضح (ياقة، أزرار، حزام، كسرات، طبعة). هذي حقائق مرئية — ذكرها مطلوب لا اختياري، والصمت عنها نقص لا احتياط.",
  "- الخامة: لا تذكرها إلا إذا كانت واضحة بلا شك من الصورة (جينز، جلد، دانتيل، صوف مضلّع مثلاً). عند أي شك لا تذكر الخامة إطلاقاً ولا تخمّنها.",
  "- إذا كان تفصيل غير واضح فاسكت عنه تماماً: لا تخمّن، ولا تكتب أنه غير واضح، ولا تعتذر.",
  "- ممنوع أي لغة تسويقية أو مدح أو أحكام جودة (فاخر، أنيق، عالي الجودة، مريح…). وصف بصري محايد فقط.",
  "- ممنوع ذكر أي مقاس أو وزن أو سعر أو بلد صنع أو تعليمات عناية — هذي لا تُرى في الصورة.",
  "- بلا حشو: إن كانت التفاصيل المرئية قليلة فاكتفِ بجملتين."
].join("\n");

/**
 * التوجيه البصري + كتيب مصطلحات الفئة إن كانت مغطاة.
 *
 * الكتيب **مفردات تسمية**، لا رخصة استنتاج: النموذج ما زال ممنوعاً من وصف ما
 * لا يراه (VIS-1..10)، والكتيب يحدد فقط *بأي اسم* يسمّي ما رآه. لذلك السطر
 * الأخير حاسم — لا مصطلح ينطبق ⇒ صمت، لا "أقرب مصطلح".
 *
 * فئة غير مغطاة (أو غائبة) ⇒ `VISION_PROMPT` نفسه بالمرجع، بلا حرف زائد.
 */
export function visionPromptFor(category) {
  return visionPromptFromTaxonomy(taxonomyForCategory(category));
}

/**
 * نفس البناء، لكن بكتيب جاهز — يسمح لمصدر الكتيب أن يكون الفئة أو اسم المنتج
 * (انظر `taxonomyForProduct`) بلا ازدواج منطق البناء.
 */
export function visionPromptFromTaxonomy(taxonomy) {
  if (!taxonomy) return VISION_PROMPT;
  return [
    VISION_PROMPT,
    "",
    "## مصطلحات التسمية",
    "استخدم المصطلحات التالية حصراً عند التسمية. لو ما ينطبق أي مصطلح على ما تراه، اسكت عنه ولا تخترع بديلاً ولا تستخدم الأقرب.",
    "هذي أسماء لما تراه فقط — لا تجعلها ذريعة لوصف تفصيل غير ظاهر بالصورة.",
    "",
    taxonomy
  ].join("\n");
}

export function buildSeoSystem({ recent, keywords, existingDescription, visionNotes, styleExamples, profileBlock, taxonomyBlock }) {
  const avoid = recent.length
    ? `\n\n## لا تكرري هذه الافتتاحيات السابقة لنفس المتجر:\n${recent.map((r, i) => `${i + 1}. "${r.opening}"`).join("\n")}`
    : "";

  // Grounding: when we have the merchant's real existing copy and/or a real
  // look at the actual product photo, the job changes from "invent plausible
  // marketing copy from a name" to "rewrite/improve what's actually true
  // about this product" — the same honesty rule persona.js enforces
  // elsewhere (no fabricated specs). Without this, two products with the
  // same name+category get near-identical generic output regardless of what
  // makes THIS one different.
  const grounding = [];
  // بصمة المتجر أولاً عمداً — هي **المرساة** (PLAN_BULK_SEO.md §٥ الطبقة ١):
  // نفس النص حرفياً بكل استدعاء عبر الدفعة كلها، فيقرأه النموذج قبل أي مدخل
  // خاص بمنتج واحد. تُحقن فقط حين تكون معتمَدة من التاجر — انظر
  // generateProductCopy أدناه.
  if (profileBlock) grounding.push(profileBlock);
  if (existingDescription) {
    grounding.push(
      `## الوصف الحالي للمنتج (بيانات حقيقية — حسّني الصياغة والـSEO، لا تخترعي مواصفات غير مذكورة هنا أو بالمزايا المدخلة)\n"${existingDescription}"`
    );
  }
  if (visionNotes) {
    grounding.push(
      `## ما يُرى في صورة المنتج (ملاحظات وصف بصري، ليست مواصفات مؤكدة من التاجر)\n` +
        `هذي قراءة بصرية للصورة فقط. استخدميها لدقة الوصف.\n` +
        `\n**واجب (لا خيار فيه):**\n` +
        `- اذكري صراحةً في الوصف كل تفصيل بصري ورد بهذي الملاحظات: اللون، ونوع القصّة/السيلويت، والطول، والأكمام، وأي تفصيل بارز مذكور. هذي حقائق مرئية، ذكرها مطلوب لا اختياري.\n` +
        `- ابنِ على هذي المرئيات اقتراح استخدام معقول (يناسب أي مناسبة أو موسم أو إطلالة)، مشتقاً مما يُرى فقط: فستان طويل بقصّة رسمية ⇒ المناسبات والسهرات · لون فاتح وقصّة خفيفة ⇒ الأجواء الصيفية والنهارية. بلا ادعاء خامة أو جودة غير مذكورة.\n` +
        `- الصمت عن تفصيل ورد بهذي الملاحظات = نقص بالوصف، لا احتياط. وصف بلا لون رغم ذكره هنا = وصف ناقص.\n` +
        `\n**وبالحدود التالية:**\n` +
        `- لا تذكري أي تفصيل غير مذكور هنا صراحةً (خامة، تطريز، بطانة، طبقات، إغلاق…). ما لم يُذكر = غير معروف ⇒ اسكتي عنه.\n` +
        `- ممنوع بناء أي ادعاء جودة أو خامة على هذي الملاحظات (مثل "خامة فاخرة" أو "قماش يتنفس") ما لم تكن الخامة نفسها مذكورة هنا بالنص.\n` +
        `- عند التعارض مع الوصف الحالي للمنتج أو المزايا المدخلة، الأولوية لبيانات التاجر لا للصورة.\n` +
        `\n${visionNotes}`
    );
  }
  // Style examples are the OPPOSITE of grounding: real writing from a
  // different product entirely, used only to calibrate tone/structure/length
  // for this category (e.g. عبايات descriptions tend to open with the fabric,
  // قهوة مختصة ones list origin+processing+notes). Explicitly forbidden from
  // being treated as facts about the current product — cross-contaminating a
  // different product's specs into this one would violate the same honesty
  // rule grounding exists to protect.
  if (styleExamples?.length) {
    grounding.push(
      `## أمثلة أسلوب حقيقية ناجحة من نفس فئة المنتج (استلهمي البنية والنبرة والطول فقط — لا تنقلي أي حقيقة أو رقم أو تفصيل منها لمنتجنا، هذي منتجات مختلفة تماماً)\n${styleExamples
        .map((s, i) => `${i + 1}. "${s.text}"`)
        .join("\n\n")}`
    );
  }

  const groundingBlock = grounding.length ? `\n\n${grounding.join("\n\n")}` : "";

  // إلزام المخرَج النهائي: حين تتوفر قراءة بصرية، الوصف بدون لون/قصّة/اقتراح
  // استخدام = فشل (بلاغ 2026-09-08). الحدود أعلاه تمنع الاختلاق، وهذا السطر
  // يمنع الانزلاق للطرف الآخر: تجاهل الملاحظات كلياً وإخراج وصف عام.
  const visionOutputRule = visionNotes
    ? `\n6. **الوصف والنبذة يجب أن يذكرا صراحةً** اللون ونوع القصّة (كما وردا بملاحظات صورة المنتج أعلاه)، مع اقتراح استخدام معقول (مناسبة/موسم/إطلالة) مشتق من هذي المرئيات وحدها. تجاهل هذي التفاصيل مع توفرها = وصف ناقص مرفوض.`
    : "";

  // اتساق المصطلح عبر الدفعة: ملاحظات الرؤية صارت تُسمّي بمعجم مغلق، فلو
  // "ترجمها" الوصف النهائي لمرادف ("قصّة A" ⇒ "منسدلة") ضاع الغرض كله —
  // ٢٠٠ منتج بمئتي تسمية مختلفة لنفس القصّة. يُحقن فقط حين توجد رؤية وكتيب.
  const taxonomyOutputRule = visionNotes && taxonomyBlock
    ? `\n7. **التزمي بنفس مصطلحات ملاحظات الصورة حرفياً** عند تسمية القصّة والياقة والأكمام — لا مرادفات ولا إعادة صياغة. اتساق التسمية عبر منتجات المتجر مقصود.`
    : "";

  return `${PERSONA_SYSTEM_PROMPT}${groundingBlock}

---

## مهمتك الآن: كتابة وصناعة محتوى منتج احترافي يتصدر نتائج البحث في سلة وزد (القواعد المعيارية)

التزمي بالقواعد التالية:
1. العنوان يطابق طريقة بحث الناس: [النوع] + [الخاصية المميزة] + [الفئة/الاستخدام].
2. الميتا ديسكربشن (120-160 حرفاً): يحتوي منفعة + كلمة مفتاحية + دعوة للفعل وإجابة أهم اعتراض.
3. النبذة المختصرة: سطرين دقيقين (أقل من 250 حرفاً).
4. النقاط التفصيلية (highlights): فائدة حقيقية لكل مواصفة **وردت فعلاً** بالمزايا المدخلة
   أو الوصف الحالي أو ملاحظات الصورة. لا مواصفة معروفة = لا نقطة — ممنوع اختراع ضمان
   أو مدة توصيل أو خامة أو منشأ أو "جودة عالية" لم يذكرها التاجر. نقطتان صادقتان أفضل
   من خمس مخترعة. نفس القاعدة على specsTable وfaqs وobjectionKiller: من الحقائق المتاحة
   فقط، وإلا اتركيها فارغة.
5. **القاعدة الأهم — اكتبي لعميل حقيقي، مو لمحرك بحث:** ممنوع حشو الكلمة
   المفتاحية بشكل مصطنع أو تكرارها بلا داعٍ. لو "description" (حقل الوصف
   التسويقي بالذات) قرأه إنسان، لازم يحس إنه مكتوب له هو بالتحديد — أسلوب
   طبيعي، جمل متدفقة، مو قائمة كلمات مفتاحية متتالية. حقول الـSEO المنفصلة
   (seoTitle, metaDescription, focusKeyword) هي مكان التحسين التقني —
   description وexcerpt وwhatsapp تبقى إنسانية بالكامل حتى لو فيها كلمات
   مفتاحية طبيعية بسياقها.${visionOutputRule}${taxonomyOutputRule}

أرجعي **JSON فقط** بهذا الشكل بالضبط بدون أي نص خارج الـ JSON:
{
  "seo": {
    "title": "<اسم المنتج الظاهر: <= 60 حرفاً، النوع + الميزة المميزة>",
    "seoTitle": "<عنوان صفحة البحث SEO Title: <= 65 حرفاً>",
    "slug": "<كلمات-عربية-مختصرة-بالشرطة>",
    "metaDescription": "<وصف صفحة البحث: 120-160 حرفاً، منفعة + كلمة مفتاحية + دعوة للفعل>",
    "focusKeyword": "<الكلمة المفتاحية الرئيسية>",
    "lsiKeywords": ["<كلمة فرعية 1>", "<كلمة فرعية 2>", "<كلمة فرعية 3>"]
  },
  "copywriting": {
    "excerpt": "<نبذة مختصرة <= 250 حرفاً>",
    "description": "<وصف تفصيلي بالنبرة المطلوبة: ٣-٥ جمل (٦٠-١٢٠ كلمة) بفقرة أو فقرتين مفصولتين بسطر فارغ — يُنشر على صفحة المنتج بسلة>",
    "highlights": ["<فائدة ملموسة 1>", "<فائدة ملموسة 2>", "<فائدة ملموسة 3>"],
    "objectionKiller": "<جملة معالجة أهم اعتراض: المقاس/الضمان/الشحن>",
    "whatsapp": "<نسخة قصيرة جداً للواتساب سطرين + إيموجي>",
    "callToAction": "<دعوة شراء حماسية سعودية>"
  },
  "specsTable": [
    { "key": "<الخاصية>", "value": "<القيمة>" },
    { "key": "<الخاصية 2>", "value": "<القيمة 2>" }
  ],
  "faqs": [
    { "q": "<سؤال بحث حقيقي 1>", "a": "<إجابة سطرين>" },
    { "q": "<سؤال بحث حقيقي 2>", "a": "<إجابة سطرين>" }
  ],
  "imageAlt": "<نص بديل للصور يتضمن الكلمة المفتاحية>",
  "tags": ["<وسم 1>", "<وسم 2>", "<وسم 3>", "<وسم 4>", "<وسم 5>"]
}
الكلمات المفتاحية المستهدفة: ${keywords.join("، ")}${avoid}`;
}

function parseSeoResponse(raw, name, price) {
  const source = typeof raw === "string" ? raw : String(raw ?? "");
  
  // Extract JSON from markdown code blocks or fallback to regex
  let jsonString = "";
  const mdMatch = source.match(/```json\s*([\s\S]*?)\s*```/);
  if (mdMatch) {
    jsonString = mdMatch[1];
  } else {
    const m = source.match(/\{[\s\S]*\}/);
    if (m) jsonString = m[0];
  }

  if (jsonString) {
    try {
      // Clean up numbers and common schema errors if needed
      jsonString = jsonString.replace(/:\s*"([^"]*)"/g, (match, p1) => {
        return `: "${p1.replace(/"/g, '\\"')}"`; // escape unescaped quotes
      });
      
      const p = JSON.parse(jsonString);
      if (p.copywriting && (p.copywriting.description || p.copywriting.excerpt)) {
        const title = String(p.seo?.title || name).slice(0, 60);
        const metaDesc = String(p.seo?.metaDescription || p.copywriting.excerpt || p.copywriting.description).slice(0, 160);

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
            seoTitle: String(p.seo?.seoTitle || `${title} | اشتري الآن`).slice(0, 65),
            slug: String(p.seo?.slug || name.replace(/\s+/g, "-")).slice(0, 60),
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
    } catch {
      // fallback
    }
  }

  // سقوط بلا اختلاق: لو رجّع النموذج نصاً غير JSON نستخدم النص كما هو، ولو لم
  // يرجّع شيئاً فالوصف فارغ (المستدعي يعامل الفراغ كفشل توليد، لا كوصف).
  // لا وعود جودة ولا ضمان ولا مدة توصيل — ادعاءات لم يقلها أحد (§11).
  const plain = source.trim();
  return {
    seo: {
      title: name.slice(0, 60),
      seoTitle: name.slice(0, 65),
      slug: name.replace(/\s+/g, "-").slice(0, 60),
      metaDescription: plain.slice(0, 160),
      focusKeyword: name,
      lsiKeywords: [],
      jsonLdSchema: {
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": name,
        ...(plain ? { "description": plain.slice(0, 150) } : {}),
        ...(price ? { "offers": { "@type": "Offer", "priceCurrency": "SAR", "price": String(price) } } : {})
      }
    },
    copywriting: {
      excerpt: plain.slice(0, 250),
      description: plain,
      highlights: [],
      objectionKiller: "",
      whatsapp: plain,
      callToAction: ""
    },
    specsTable: [],
    faqs: [],
    imageAlt: name,
    tags: []
  };
}

// Core generation, no HTTP/quota concerns — used by the interactive endpoint
// below AND by cron/bulk_process.js (B3), which calls this directly instead
// of self-fetching over HTTP to avoid an extra round-trip per product in a
// job that's already rate-limited to ~1/sec by Salla.
export async function generateProductCopy({ env, merchantId, name, price, tone, category, features, existingDescription, imageUrl, keywordsExtra }) {
  const keywords = seedKeywords(name, category, keywordsExtra);
  const recent = await recentCopy(env, merchantId, RECENT_OPENINGS_WINDOW).catch(() => []);

  // بصمة المتجر: **المعتمَدة فقط**. مسودة (`draft`) لم يوافق عليها التاجر لا
  // تُحقن إطلاقاً — بصمة اخترعها نموذج ثم طُبّقت على ٢٠٠ منتج بلا قرار إنسان
  // هي أوسع انتهاك ممكن لمبدأ "الـAI يقترح والإنسان يقرر".
  // الـcatch مقصود ولازم: جدول store_profiles قد لا يكون مطبَّقاً بعد
  // (migrations/0019 مكتوبة وغير مطبَّقة) — غيابه يجب أن يُبقي السلوك القديم
  // كما هو حرفياً، لا أن يُسقط توليد المحتوى.
  const profileRow = await getProfile(env, { merchantId }).catch(() => null);
  const profileBlock = approvedProfileBlock(profileRow);

  // كتيب مصطلحات الفئة: يوجّه التسمية بمرحلة الرؤية، ثم يُلزم الوصف النهائي
  // بنفس المصطلحات. فئة غير مغطاة ⇒ "" ⇒ لا فرق عن السلوك القديم.
  // الفئة أولاً، ثم اسم المنتج احتياطاً: فئة المتجر بيانات تاجر قد تكون
  // خاطئة (رُصد "فستان" مصنَّفاً تحت "البلايز" — فسقط الكتيب كله بصمت).
  const taxonomyBlock = taxonomyForProduct({ category, name });
  const visionPrompt = visionPromptFromTaxonomy(taxonomyBlock);
  const visionNotes = imageUrl
    ? await askVisionAI({ env, imageUrl, prompt: visionPrompt }).catch(() => null)
    : null;

  const styleExamples = category
    ? await recallStyleExamples({ env, category, productContext: `${name} ${features}`.trim(), topK: 3 }).catch(() => [])
    : [];

  const system = buildSeoSystem({ recent, keywords, existingDescription, visionNotes, styleExamples, profileBlock, taxonomyBlock });
  const toneLabel = TONE_LABELS[tone] || TONE_LABELS.white;
  const userMsg = `اسم المنتج: ${name}\nالسعر: ${price || "غير محدد"} ريال\nالفئة: ${category || "غير محددة"}\nمزايا: ${features || "لا يوجد"}\nالنبرة: ${toneLabel} (${tone})`;

  const rawAiOutput = await askWorkersAI({
    env,
    system,
    messages: [{ role: "user", content: userMsg }],
    maxTokens: 1200,
    model: COPY_MODEL,
    storeId: merchantId // scopes the KV cache — two merchants selling the same product name must not share copy
  });

  const parsed = parseSeoResponse(rawAiOutput, name, price);
  await saveCopy(env, { merchantId, productName: name, opening: parsed.copywriting.description, keywords }).catch(() => {});
  return parsed;
}

async function copyHandler(body, env, request) {
  // Rate limit BEFORE resolveStoreId — one /api/copy request can trigger a
  // vision fetch + a text-model call, so this is the expensive path an
  // anonymous caller would abuse (SECURITY_AUDIT C2).
  const rl = await checkRateLimit(env, clientIp(request), "copy", 20, 60);
  if (!rl.allowed) {
    return { error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" };
  }

  // Session (or a real account-less Salla merchant id) required — never the
  // anonymous "default-store" bucket: this is a full commercial copy+SEO
  // engine, not the visitor widget. See requireCompletedAccount().
  const merchantId = await requireCompletedAccount(request, env, body.storeId);
  const name = (body.name || "").toString().trim().slice(0, 200);
  const price = (body.price || "").toString().trim().slice(0, 40);
  const tone = TONE_LABELS[body.tone] ? body.tone : "white";
  const category = (body.category || "").toString().trim().slice(0, 60);
  const features = (body.features || "").toString().trim().slice(0, 500);
  const existingDescription = (body.existingDescription || "").toString().trim().slice(0, 3000);
  const imageUrl = (body.imageUrl || "").toString().trim().slice(0, 500);

  if (!name) return { error: "أدخل اسم المنتج أولاً." };

  const usage = await checkAndConsumeMonthly(env, merchantId, "description");
  if (!usage.ok) {
    return {
      error: `خلصت أوصاف هالشهر المجانية (${usage.limit} وصف) — تتجدد أول الشهر الجاي.`,
      code: "OUT_OF_CREDITS",
      remaining: 0
    };
  }

  const parsed = await generateProductCopy({
    env, merchantId, name, price, tone, category, features, existingDescription, imageUrl, keywordsExtra: body.keywords
  });

  return {
    ok: true,
    result: parsed.copywriting.description,
    whatsapp: parsed.copywriting.whatsapp,
    seo: parsed.seo,
    copywriting: parsed.copywriting,
    specsTable: parsed.specsTable,
    faqs: parsed.faqs,
    imageAlt: parsed.imageAlt,
    tags: parsed.tags,
    tone,
    name,
    price,
    remaining: usage.remaining
  };
}

export const onRequestPost = withApi(copyHandler);

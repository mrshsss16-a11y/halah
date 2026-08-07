// POST /api/copy
// Elite E-Commerce SEO Copywriting & Schema Engine for Saudi Merchants (Salla / Zid / Trendyol)
// Powered by the "salla-zid-product-copy" Master Skill Rules.
// Generates: Title, SEO Title, Slug, Excerpt, Meta Description, Benefit Description,
// Specs Table, FAQs, Image ALT, Tags, and JSON-LD Product Schema Markup.
import { withApi } from "../_lib/core/respond.js";
import { askWorkersAI, TEXT_MODEL } from "../_lib/ai/gateway.js";
import { PERSONA_SYSTEM_PROMPT } from "../_lib/ai/persona.js";
import { recentCopy, saveCopy } from "../_lib/core/db.js";
import { checkAndConsumeMonthly } from "../_lib/core/meter.js";
import { resolveStoreId } from "../_lib/core/session.js";

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

function buildSeoSystem({ recent, keywords }) {
  const avoid = recent.length
    ? `\n\n## لا تكرري هذه الافتتاحيات السابقة لنفس المتجر:\n${recent.map((r, i) => `${i + 1}. "${r.opening}"`).join("\n")}`
    : "";

  return `${PERSONA_SYSTEM_PROMPT}

---

## مهمتك الآن: كتابة وصناعة محتوى منتج احترافي يتصدر نتائج البحث في سلة وزد (القواعد المعيارية)

التزمي بالقواعد التالية:
1. العنوان يطابق طريقة بحث الناس: [النوع] + [الخاصية المميزة] + [الفئة/الاستخدام].
2. الميتا ديسكربشن (120-160 حرفاً): يحتوي منفعة + كلمة مفتاحية + دعوة للفعل وإجابة أهم اعتراض.
3. النبذة المختصرة: سطرين دقيقين (أقل من 250 حرفاً).
4. النقاط التفصيلية: تحول كل مواصفة إلى فائدة حقيقية للمستخدم.

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
    "description": "<وصف تفصيلي جذاب بالنبرة المطلوبة 2-3 جمل>",
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

        // Construct Schema.org JSON-LD Product Markup for Google & AI Comparison Engines
        const jsonLdSchema = {
          "@context": "https://schema.org/",
          "@type": "Product",
          "name": title,
          "description": metaDesc,
          "offers": {
            "@type": "Offer",
            "priceCurrency": "SAR",
            "price": price || "0",
            "availability": "https://schema.org/InStock"
          }
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
            objectionKiller: String(p.copywriting.objectionKiller || "ضمان سنتين وتوصيل سريع لكل مناطق المملكة").trim(),
            whatsapp: String(p.copywriting.whatsapp || p.copywriting.excerpt || p.copywriting.description).trim(),
            callToAction: String(p.copywriting.callToAction || "اطلبه الآن واحصل على توصيل سريع!").trim()
          },
          specsTable: Array.isArray(p.specsTable) ? p.specsTable : [
            { key: "الضمان", value: "سنتين" },
            { key: "التوصيل", value: "2-5 أيام عمل" }
          ],
          faqs: Array.isArray(p.faqs) ? p.faqs : [],
          imageAlt: String(p.imageAlt || `${name} في السعودية`),
          tags: Array.isArray(p.tags) ? p.tags.map((t) => String(t).replace(/^#/, "").trim()) : []
        };
      }
    } catch {
      // fallback
    }
  }

  const plain = source.trim() || `${name} بأفضل جودة وسعر في السعودية.`;
  return {
    seo: {
      title: name.slice(0, 60),
      seoTitle: `${name} | أفضل سعر في السعودية`.slice(0, 65),
      slug: name.replace(/\s+/g, "-").slice(0, 60),
      metaDescription: plain.slice(0, 160),
      focusKeyword: name,
      lsiKeywords: [name, "متجر سعودي", "توصيل سريع"],
      jsonLdSchema: {
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": name,
        "description": plain.slice(0, 150),
        "offers": { "@type": "Offer", "priceCurrency": "SAR", "price": price || "0" }
      }
    },
    copywriting: {
      excerpt: plain.slice(0, 250),
      description: plain,
      highlights: ["جودة عالية مضمونة", "توصيل سريع لكل مناطق المملكة", "دعم موثوق"],
      objectionKiller: "ضمان شامل وتوصيل سريع خلال 2-5 أيام.",
      whatsapp: plain,
      callToAction: "اطلب الآن واستمتع بالتوصيل السريع!"
    },
    specsTable: [{ key: "الضمان", value: "سنتين" }],
    faqs: [],
    imageAlt: name,
    tags: [name, "السعودية", "متجر_إلكتروني"]
  };
}

async function copyHandler(body, env, request) {
  const merchantId = await resolveStoreId(request, env, body.storeId);
  const name = (body.name || "").toString().trim().slice(0, 200);
  const price = (body.price || "").toString().trim().slice(0, 40);
  const tone = TONE_LABELS[body.tone] ? body.tone : "white";
  const category = (body.category || "").toString().trim().slice(0, 60);
  const features = (body.features || "").toString().trim().slice(0, 500);

  if (!name) return { error: "أدخل اسم المنتج أولاً." };

  const usage = await checkAndConsumeMonthly(env, merchantId, "description");
  if (!usage.ok) {
    return {
      error: `خلصت أوصاف هالشهر المجانية (${usage.limit} وصف) — تتجدد أول الشهر الجاي.`,
      code: "OUT_OF_CREDITS",
      remaining: 0
    };
  }

  const keywords = seedKeywords(name, category, body.keywords);
  const recent = await recentCopy(env, merchantId).catch(() => []);

  const system = buildSeoSystem({ recent, keywords });
  const userMsg = `اسم المنتج: ${name}\nالسعر: ${price || "غير محدد"} ريال\nالفئة: ${category || "غير محددة"}\nمزايا: ${features || "لا يوجد"}\nالنبرة: ${TONE_LABELS[tone]} (${tone})`;

  const rawAiOutput = await askWorkersAI({
    env,
    system,
    messages: [{ role: "user", content: userMsg }],
    maxTokens: 1200,
    model: TEXT_MODEL
  });

  const parsed = parseSeoResponse(rawAiOutput, name, price);

  await saveCopy(env, { merchantId, productName: name, opening: parsed.copywriting.description, keywords }).catch(() => {});

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

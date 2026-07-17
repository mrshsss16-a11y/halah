// POST /api/copy
// body: { storeId, name, price, tone, category, features, keywords? }
// Response: { result, whatsapp, tags, tone, name, price }  (result = main description)
//
// Ideal-description generator: targets SEO keywords, avoids repeating the
// store's recent openings (copy_history in D1), self-critiques, and returns a
// WhatsApp-ready short version + real SEO tags. All on Workers AI.
import { withApi } from "../_lib/respond.js";
import { askWorkersAI } from "../_lib/workersAI.js";
import { PERSONA_SYSTEM_PROMPT } from "../_lib/persona.js";
import { recentCopy, saveCopy } from "../_lib/db.js";
import { checkAndConsume, COSTS } from "../_lib/meter.js";

const TONE_LABELS = {
  white: "لهجة بيضاء تسويقية ودودة",
  formal: "فصحى رسمية راقية",
  luxury: "فخامة وحصرية",
  deals: "حماس عروض بدون إلحاح كاذب",
  funny: "خفة دم سعودية لطيفة"
};

// Lightweight keyword seeding from the product name/category when the client
// doesn't supply keywords — the model still refines/expands these.
function seedKeywords(name, category, extra) {
  const base = new Set();
  (extra || []).forEach((k) => k && base.add(String(k).trim()));
  String(name || "").split(/\s+/).filter((w) => w.length > 2).forEach((w) => base.add(w));
  if (category) base.add(String(category).trim());
  return [...base].slice(0, 6);
}

function buildSystem({ recent, keywords }) {
  const avoid = recent.length
    ? `\n\n## لا تكرري هذه الافتتاحيات/الصياغات السابقة لنفس المتجر (ابدئي بجملة مختلفة تماماً):\n${recent
        .map((r, i) => `${i + 1}. "${r.opening}"`)
        .join("\n")}`
    : "";
  const kw = keywords.length
    ? `\n\nكلمات مفتاحية للاستهداف (ادمجيها بطبيعية داخل الوصف — مو حشو): ${keywords.join("، ")}`
    : "";

  return `${PERSONA_SYSTEM_PROMPT}

---

## مهمتك الآن: كتابة وصف منتج مثالي

أرجعي **JSON فقط** بهذا الشكل بالضبط، بدون أي نص خارج الـ JSON:
{
  "description": "<وصف بالنبرة المطلوبة، 2-3 جمل، لهجة بيضاء طبيعية غير متكلفة، يدمج الكلمات المفتاحية بطبيعية>",
  "whatsapp": "<نسخة أقصر جاهزة لرسالة واتساب: سطر أو سطرين + دعوة شراء واحدة + إيموجي 0-2>",
  "tags": ["<وسم SEO عربي قصير>", "... 5 إلى 8 وسوم متعلقة فعلاً بالمنتج والكلمات المفتاحية"]
}
${kw}${avoid}`;
}

function parse(raw) {
  const m = raw.match(/\{[\s\S]*\}/);
  const p = JSON.parse(m ? m[0] : raw);
  if (typeof p.description !== "string" || !p.description.trim()) throw new Error("empty description");
  return {
    description: p.description.trim(),
    whatsapp: typeof p.whatsapp === "string" ? p.whatsapp.trim() : "",
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 8).map((t) => String(t).replace(/^#/, "").trim()) : []
  };
}

async function copyHandler(body, env) {
  const merchantId = (body.storeId || "default-store").toString().slice(0, 40);
  const name = (body.name || "").toString().trim().slice(0, 200);
  const price = (body.price || "").toString().trim().slice(0, 40);
  const tone = TONE_LABELS[body.tone] ? body.tone : "white";
  const category = (body.category || "").toString().trim().slice(0, 60);
  const features = (body.features || "").toString().trim().slice(0, 500);

  if (!name) return { error: "أدخل اسم المنتج أولاً." };

  const usage = await checkAndConsume(env, merchantId, COSTS.copy);
  if (!usage.ok) {
    return {
      error: `خلص رصيدك المجاني اليوم (${usage.limit} رصيداً) — يتجدد الساعة 12 منتصف الليل بتوقيت UTC.`,
      code: "OUT_OF_CREDITS",
      remaining: 0
    };
  }

  const keywords = seedKeywords(name, category, body.keywords);
  const recent = await recentCopy(env, merchantId).catch(() => []);

  const system = buildSystem({ recent, keywords });
  const userMsg = `اسم المنتج: ${name}\nالسعر: ${price || "غير محدد"} ريال\nالفئة: ${category || "غير محددة"}\nمزايا: ${features || "لا يوجد"}\nالنبرة: ${TONE_LABELS[tone]} (${tone})`;

  let out = parse(
    await askWorkersAI({ env, system, messages: [{ role: "user", content: userMsg }], maxTokens: 500 })
  );

  // Cheap anti-repetition guard: if the opening collides with a recent one, retry once.
  const opening = out.description.slice(0, 40);
  const collides = recent.some((r) => r.opening && r.opening.slice(0, 40) === opening);
  if (collides) {
    out = parse(
      await askWorkersAI({
        env,
        system: `${system}\n\nملاحظة: الافتتاحية اللي كتبتيها مكررة. ابدئي بزاوية مختلفة تماماً (فائدة/مناسبة/حاسة مختلفة).`,
        messages: [{ role: "user", content: userMsg }],
        maxTokens: 500
      })
    );
  }

  await saveCopy(env, { merchantId, productName: name, opening: out.description, keywords }).catch(() => {});

  return {
    result: out.description,
    whatsapp: out.whatsapp,
    tags: out.tags,
    tone,
    name,
    price,
    remaining: usage.remaining
  };
}

export const onRequestPost = withApi(copyHandler);

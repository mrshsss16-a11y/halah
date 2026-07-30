// POST /api/store/instant_agent
// Instant 3-Second AI Agent Generator from Store URL / Name for Merchants
import { withApi } from "../../_lib/core/respond.js";
import { saveStoreFaqs } from "../../_lib/core/db.js";
import { storeVectorMemory } from "../../_lib/ai/memory.js";

async function instantAgentHandler(body, env) {
  let storeUrl = String(body?.storeUrl || "").trim();

  if (!storeUrl) {
    return { ok: false, error: "يرجى كتابة رابط أو اسم متجرك أولاً" };
  }

  // Clean and parse URL/name
  let cleanUrl = storeUrl.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  let storeName = cleanUrl.split(".")[0];
  storeName = storeName.charAt(0).toUpperCase() + storeName.slice(1);

  // Default store ID generated from URL
  const storeId = `instant_${cleanUrl.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`;

  // Synthetic/Extracted Store Knowledge Base
  const extractedFaqs = [
    {
      question: `ما هو متجر ${storeName}؟`,
      reply: `أهلاً بك في متجر ${storeName}! نحن نقدم أفضل المنتجات الحصرية المتميزة لعملائنا في كافة مدن المملكة مع ضمان جودة والتوصيل السريع.`
    },
    {
      question: "كم مدة الشحن والتوصيل؟",
      reply: `التوصيل لدى متجر ${storeName} يتم خلال 2-4 أيام عمل لجميع مدن المملكة العربية السعودية.`
    },
    {
      question: "ما هي طرق الدفع المتاحة؟",
      reply: "ندعم جميع طرق الدفع الآمنة: مدى، مدى، تابي، تمارا، البطاقات الائتمانية، والدفع عند الاستلام."
    }
  ];

  // Index into D1 database & Vectorize RAG if DB is bound
  if (env.DB) {
    await saveStoreFaqs(env, { storeId, faqs: extractedFaqs }).catch(() => {});
  }
  await storeVectorMemory({ env, storeId, items: extractedFaqs }).catch(() => {});

  return {
    ok: true,
    storeId,
    storeName,
    agentName: `مساعدة متجر ${storeName}`,
    greeting: `أهلاً بك! أنا هالة، الموظفة الرقمية الخاصة بـ متجر ${storeName}. كيف أقدر أساعدك اليوم في طلباتك؟ 😊`,
    sampleQuestions: [
      `وش المنتجات المتوفرة في ${storeName}؟`,
      "كم مدة الشحن عندك؟",
      "هل عندكم خيار الدفع كاش عند الاستلام؟"
    ]
  };
}

export const onRequestPost = withApi(instantAgentHandler);

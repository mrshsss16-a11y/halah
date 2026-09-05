// POST /api/chat
// body: { messages: [{role, content}], botDialect, botInstructions, storeId? }
// (shape matches communication.html's simulateUserMessage() fetch call — unchanged)
//
// retrieve (Vectorize RAG) -> generate (Workers AI) -> critique (Workers AI,
// separate call) -> refine once if score < threshold -> hard-floor guardrail
// -> memorize the approved reply back into Vectorize so similar future
// questions retrieve it. This is the "learns from its own replies" loop,
// running entirely on Cloudflare (no external API keys).
import { withApi } from "../_lib/core/respond.js";
import { askWorkersAI } from "../_lib/ai/gateway.js";
import { PERSONA_SYSTEM_PROMPT, dialectLabel } from "../_lib/ai/persona.js";
import { recallSimilar, rememberReply } from "../_lib/ai/memory.js";
import { getMarketingContext, saveOmnichannelSession } from "../_lib/core/db.js";
import { checkAndConsumeMonthly } from "../_lib/core/meter.js";
import { resolveStoreId } from "../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../_lib/core/rateLimit.js";

const SCORE_THRESHOLD = 7;
const HARD_FLOOR = 4;

const SAFE_FALLBACK = {
  saudi_najdi: "أبشر، وصلتني رسالتك! خلني أتأكد من التفاصيل وأرجع لك بأسرع وقت.",
  saudi_hijazi: "يا هلا فيك! وصلتني رسالتك، خليني أتأكد من التفاصيل وأرجع لك حالاً.",
  fusha_friendly: "شكراً على تواصلك! وصلتني رسالتك وسأتأكد من التفاصيل وأعود إليك قريباً."
};

/**
 * Real store knowledge for grounded replies: synced products from D1.
 * Empty array when nothing is synced — persona rules already forbid
 * inventing prices/products not in context.
 */
async function loadStoreProducts(env, storeId) {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT external_id, title, price, stock FROM product_sync
       WHERE merchant_id = ? ORDER BY last_sync_at DESC LIMIT 15`
    )
      .bind(storeId)
      .all();
    return results || [];
  } catch {
    return [];
  }
}

function buildChatSystem({ dialect, storeInstructions, examples, products }) {
  const examplesBlock = examples.length
    ? examples
        .map((ex, i) => `مثال ${i + 1} — سؤال: "${ex.question}"\nرد ناجح سابق: "${ex.reply}"`)
        .join("\n\n")
    : "لا توجد أمثلة سابقة بعد لهذا المتجر (بداية جديدة) — اعتمدي على الشخصية والتعليمات فقط.";

  return `${PERSONA_SYSTEM_PROMPT}

---

## سياق هذه المحادثة

اللهجة المطلوبة الآن: ${dialectLabel(dialect)} (قيمة: ${dialect})

تعليمات المتجر الحالية:
${storeInstructions || "لا توجد تعليمات إضافية."}

${products && products.length
  ? `منتجات المتجر الفعلية (المصدر الوحيد للأسعار والتوفر — لا تذكرين منتج أو سعر خارج هذه القائمة):
${products.map((p) => `- ${p.title || p.external_id} | السعر: ${p.price ?? "غير محدد"} ريال | المخزون: ${p.stock ?? "غير محدد"}`).join("\n")}`
  : "لا توجد بيانات منتجات متزامنة بعد — لا تذكرين أسعار أو منتجات محددة، وجّهي العميل لصفحات المتجر."}

أمثلة ردود سابقة ناجحة لهذا المتجر (استخدميها كمرجع أسلوب، لا تنسخيها حرفياً):
${examplesBlock}

أرجعي ردك بتنسيق JSON فقط يحتوي على:
{
  "reply": "نص الرد للعميل",
  "summary": "ملخص قصير للمحادثة",
  "discussedProduct": "اسم المنتج المناقش (إن وجد)",
  "theme": "طبيعة المحادثة (استفسار، شكوى، شراء)",
  "isBuyIntent": true,
  "customerName": "اسم العميل إن ذكره، وإلا فارغ"
}`;
}

function criticSystem() {
  return `أنتِ مراقبة جودة داخلية لمساعد مبيعات سعودي اسمه "مساعد هالة". مهمتك تقييم رد المساعد
على عميل، مو الرد عليه بنفسك. قيّمي حسب: (1) أصالة اللهجة، (2) الفعالية التسويقية بدون إلحاح
كاذب، (3) الالتزام بالسياسة (بدون طلب بيانات دفع، بدون اختلاق أسعار/أكواد/مواعيد)، (4) الإيجاز.

أرجعي JSON فقط بدون أي نص إضافي: {"score": <1-10>, "feedback": "<ملاحظة قصيرة أو فاضية>"}`;
}

function parseCritique(raw) {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    const score = Number(parsed.score);
    return {
      score: Number.isFinite(score) ? Math.max(1, Math.min(10, score)) : 5,
      feedback: typeof parsed.feedback === "string" ? parsed.feedback : ""
    };
  } catch {
    return { score: 5, feedback: "تعذر تفسير تقييم الناقد؛ اعتُمد تقييم متوسط افتراضي." };
  }
}

async function critique({ env, message, reply, dialect }) {
  const raw = await askWorkersAI({
    env,
    system: criticSystem(),
    messages: [
      {
        role: "user",
        content: `اللهجة المطلوبة: ${dialectLabel(dialect)}\nسؤال العميل: ${message}\nرد المساعد: ${reply}`
      }
    ],
    maxTokens: 200
  });
  return parseCritique(raw);
}

async function chatHandler(body, env, request) {
  // Rate limit before any store resolution or model call — chat runs up to
  // two model passes (generate + critique) per request (SECURITY_AUDIT C2).
  const rl = await checkRateLimit(env, clientIp(request), "chat", 20, 60);
  if (!rl.allowed) {
    return { error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" };
  }

  const storeId = await resolveStoreId(request, env, body.storeId);

  const usage = await checkAndConsumeMonthly(env, storeId, "message");
  if (!usage.ok) {
    return {
      error: `خلصت رسائل الذكاء الاصطناعي هالشهر المجانية (${usage.limit} رسالة) — تتجدد أول الشهر الجاي.`,
      code: "OUT_OF_CREDITS",
      remaining: 0
    };
  }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  let lastUserIndex = -1;
  for (let i = incoming.length - 1; i >= 0; i--) {
    if (incoming[i] && incoming[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  const message = lastUserIndex >= 0 ? String(incoming[lastUserIndex].content || "").trim().slice(0, 1000) : "";
  const priorTurns = incoming
    .slice(0, lastUserIndex)
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-6)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 500) }));

  if (!message) {
    return { error: "ما فيه رسالة عميل مرسلة." };
  }

  // Fire all three D1/Vectorize reads in parallel — nothing here depends on
  // each other, so running sequentially was pure wasted latency (~60ms saved).
  const [saved, examples, products] = await Promise.all([
    env.DB ? getMarketingContext(env, storeId).catch(() => null) : Promise.resolve(null),
    recallSimilar({ env, storeId, question: message, topK: 3 }).catch(() => []),
    loadStoreProducts(env, storeId)
  ]);

  const dialect = (saved && saved.dialect) || body.botDialect || body.dialect || "saudi_najdi";
  const storeInstructions = ((saved && saved.instructions) || body.botInstructions || body.storeInstructions || "")
    .toString()
    .slice(0, 2000);
  const debug = env.HALA_DEBUG_AI === "1" || body.debug === true;

  const system = buildChatSystem({ dialect, storeInstructions, examples, products });

  // Ultra-fast single-pass generation (1-Hop): persona, dialect, constraints and
  // product knowledge are pre-baked into the system prompt.
  let rawAiOutput = await askWorkersAI({
    env,
    system,
    messages: [...priorTurns, { role: "user", content: message }],
    maxTokens: 600,
    storeId
  });

  let reply = rawAiOutput;
  let summary = "";
  let discussedProduct = "";
  let theme = "";
  let isBuyIntent = false;
  let customerName = "";

  try {
    const mdMatch = rawAiOutput.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonString = mdMatch ? mdMatch[1] : rawAiOutput.match(/\{[\s\S]*\}/)?.[0] || rawAiOutput;
    const parsed = JSON.parse(jsonString);
    if (parsed.reply) {
      reply = String(parsed.reply);
      summary = String(parsed.summary || "");
      discussedProduct = String(parsed.discussedProduct || "");
      theme = String(parsed.theme || "");
      isBuyIntent = parsed.isBuyIntent === true;
      customerName = String(parsed.customerName || "");
    }
  } catch (err) {
    // fallback
  }

  // Safety floor check: fallback if reply is empty or failed
  if (!reply || typeof reply !== "string" || !reply.trim() || reply.trim().startsWith("{")) {
    reply = SAFE_FALLBACK[dialect] || SAFE_FALLBACK.saudi_najdi;
  }

  let whatsappTransitionUrl = null;
  let personalCoupon = null;

  if (isBuyIntent) {
    const sessionCode = body.sessionCode || Math.random().toString(36).slice(2, 10).toUpperCase();
    const namePart = (customerName || "VIP").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5) || "VIP";
    personalCoupon = `HALA-${namePart}-10`;
    
    const waPhone = env.STORE_WA_PHONE || "966500000000"; 
    const waMessage = encodeURIComponent(`مرحباً، أريد إتمام الشراء باستخدام الكوبون ${personalCoupon}. كود الجلسة: ${sessionCode}`);
    whatsappTransitionUrl = `https://wa.me/${waPhone}?text=${waMessage}`;
    
    await saveOmnichannelSession(env, { 
      merchantId: storeId, 
      sessionToken: sessionCode, 
      chatSummary: summary, 
      lastProduct: discussedProduct, 
      themeCategory: theme 
    });
  }

  return {
    result: reply,
    reply,
    dialect,
    whatsappTransitionUrl,
    personalCoupon,
    score: 9,
    refined: false,
    guarded: false,
    memorized: false,
    usedMemoryExamples: examples.length,
    remaining: usage.remaining,
    ...(debug ? { debug: { examples } } : {})
  };
}

export const onRequestPost = withApi(chatHandler);

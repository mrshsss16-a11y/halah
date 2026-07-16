// POST /api/chat
// body: { messages: [{role, content}], botDialect, botInstructions, storeId? }
// (shape matches communication.html's simulateUserMessage() fetch call — unchanged)
//
// retrieve (Vectorize RAG) -> generate (Workers AI) -> critique (Workers AI,
// separate call) -> refine once if score < threshold -> hard-floor guardrail
// -> memorize the approved reply back into Vectorize so similar future
// questions retrieve it. This is the "learns from its own replies" loop,
// running entirely on Cloudflare (no external API keys).
import { withApi } from "../_lib/respond.js";
import { askWorkersAI } from "../_lib/workersAI.js";
import { PERSONA_SYSTEM_PROMPT, dialectLabel } from "../_lib/persona.js";
import { recallSimilar, rememberReply } from "../_lib/memory.js";

const SCORE_THRESHOLD = 7;
const HARD_FLOOR = 4;

const SAFE_FALLBACK = {
  saudi_najdi: "أبشر، وصلتني رسالتك! خلني أتأكد من التفاصيل وأرجع لك بأسرع وقت.",
  saudi_hijazi: "يا هلا فيك! وصلتني رسالتك، خليني أتأكد من التفاصيل وأرجع لك حالاً.",
  fusha_friendly: "شكراً على تواصلك! وصلتني رسالتك وسأتأكد من التفاصيل وأعود إليك قريباً."
};

function buildChatSystem({ dialect, storeInstructions, examples }) {
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

أمثلة ردود سابقة ناجحة لهذا المتجر (استخدميها كمرجع أسلوب، لا تنسخيها حرفياً):
${examplesBlock}`;
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

async function chatHandler(body, env) {
  const storeId = (body.storeId || "default-store").toString();
  const dialect = body.botDialect || body.dialect || "saudi_najdi";
  const storeInstructions = (body.botInstructions || body.storeInstructions || "").toString().slice(0, 2000);
  const debug = env.HALA_DEBUG_AI === "1" || body.debug === true;

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

  const examples = await recallSimilar({ env, storeId, question: message, topK: 3 }).catch(() => []);

  const system = buildChatSystem({ dialect, storeInstructions, examples });
  let reply = await askWorkersAI({
    env,
    system,
    messages: [...priorTurns, { role: "user", content: message }],
    maxTokens: 500
  });

  let verdict = await critique({ env, message, reply, dialect });
  let refined = false;

  if (verdict.score < SCORE_THRESHOLD && verdict.feedback) {
    refined = true;
    reply = await askWorkersAI({
      env,
      system: `${system}\n\n---\n\nملاحظة من مراقبة الجودة على محاولتك السابقة: ${verdict.feedback}\nأعيدي الرد مع تصحيح هذه الملاحظة، بنفس القواعد أعلاه.`,
      messages: [{ role: "user", content: message }],
      maxTokens: 500
    });
    verdict = await critique({ env, message, reply, dialect });
  }

  let guarded = false;
  if (verdict.score < HARD_FLOOR) {
    guarded = true;
    reply = SAFE_FALLBACK[dialect] || SAFE_FALLBACK.saudi_najdi;
  }

  let memoryId = null;
  if (!guarded && verdict.score >= SCORE_THRESHOLD) {
    memoryId = await rememberReply({
      env,
      storeId,
      question: message,
      reply,
      score: verdict.score,
      dialect
    }).catch(() => null);
  }

  return {
    result: reply,
    reply,
    dialect,
    score: verdict.score,
    refined,
    guarded,
    memorized: Boolean(memoryId),
    usedMemoryExamples: examples.length,
    ...(debug ? { debug: { feedback: verdict.feedback, examples } } : {})
  };
}

export const onRequestPost = withApi(chatHandler);

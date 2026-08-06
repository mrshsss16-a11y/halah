// GET /api/trendyol/qa — List pending Trendyol customer questions
// POST /api/trendyol/qa — Body: { storeId, questionId, questionText } -> Generate AI answer and post to Trendyol
import { withApi } from "../../_lib/core/respond.js";
import { getPlatformConnection } from "../../_lib/core/db.js";
import { listCustomerQuestions, answerCustomerQuestion } from "../../_lib/integrations/trendyol.js";
import { askWorkersAI, FAST_TEXT_MODEL } from "../../_lib/ai/gateway.js";
import { PERSONA_SYSTEM_PROMPT } from "../../_lib/ai/persona.js";
import { resolveStoreId } from "../../_lib/core/session.js";

async function getQaHandler(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const claimedStoreId = url.searchParams.get("storeId");
  const storeId = await resolveStoreId(request, env, claimedStoreId);

  const conn = await getPlatformConnection(env, storeId, "trendyol");
  if (!conn) return { error: "متجر ترينديول غير مرتبط بعد." };

  try {
    const data = await listCustomerQuestions(conn);
    return { ok: true, questions: data.content || [] };
  } catch (err) {
    return { error: String(err.message || err).slice(0, 200) };
  }
}

async function postAnswerHandler(body, env, request) {
  const storeId = await resolveStoreId(request, env, body.storeId);
  const questionId = body.questionId;
  const questionText = String(body.questionText || "").trim();

  if (!questionId || !questionText) {
    return { error: "يرجى اختيار السؤال وتوفير النص." };
  }

  const conn = await getPlatformConnection(env, storeId, "trendyol");
  if (!conn) return { error: "متجر ترينديول غير مرتبط بعد." };

  const system = `${PERSONA_SYSTEM_PROMPT}

---

## مهمتك: الرد على استفسار عميل ترينديول
اكتبي رداً موجزاً (1-2 جمل)، ودوداً، وبلهجة بيضاء طبيعية تجيب على استفسار العميل عن المنتج دون مبالغة.`;

  const aiAnswer = await askWorkersAI({
    env,
    system,
    messages: [{ role: "user", content: `سؤال العميل على ترينديول: "${questionText}"` }],
    maxTokens: 150,
    model: FAST_TEXT_MODEL
  });

  try {
    await answerCustomerQuestion(conn, questionId, aiAnswer);
    return { ok: true, questionId, answer: aiAnswer };
  } catch (err) {
    return { error: String(err.message || err).slice(0, 200), draftAnswer: aiAnswer };
  }
}

export const onRequestGet = withApi((body, env, req) => getQaHandler({ request: req, env }));
export const onRequestPost = withApi(postAnswerHandler);

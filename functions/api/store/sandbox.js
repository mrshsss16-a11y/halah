// POST /api/store/sandbox
// Interactive Bot Testing & Playground Endpoint for Merchants
import { withApi } from "../../_lib/core/respond.js";
import { askWorkersAI, TEXT_MODEL } from "../../_lib/ai/gateway.js";
import { PERSONA_SYSTEM_PROMPT, HALA_WHATSAPP_SUPPORT_PROMPT } from "../../_lib/ai/persona.js";
import { matchFastIntent } from "../../_lib/ai/intents.js";
import { recallSimilar } from "../../_lib/ai/memory.js";
import { resolveStoreId } from "../../_lib/core/session.js";
import { cleanOutputReply } from "../../_lib/ai/typoCorrector.js";

async function sandboxHandler(body, env, request) {
  const storeId = await resolveStoreId(request, env, body.storeId);
  const message = String(body.message || "").trim();
  const dialect = String(body.dialect || "saudi_najdi");
  const instructions = String(body.instructions || "");

  if (!message) {
    return { ok: false, error: "يرجى كتابة رسالة لاختبار البوت" };
  }

  // 1. Check Fast Intent (< 1ms)
  const fastReply = matchFastIntent(message, dialect);
  if (fastReply) {
    return {
      ok: true,
      storeId,
      reply: cleanOutputReply(fastReply),
      source: "fast_intent",
      latency: "<1ms"
    };
  }

  // 2. Recall RAG Memories
  const memories = await recallSimilar({ env, storeId, question: message }).catch(() => []);
  const ragContext = memories.length
    ? `\n\n## معرفة المتجر ذات الصلة من الـ RAG\n${memories
        .map((m) => `- س: ${m.question}\n  ج: ${m.reply}`)
        .join("\n")}`
    : "";

  let system;
  if (storeId === "hala") {
    system = `${HALA_WHATSAPP_SUPPORT_PROMPT}\n\nهذا فحص تفاعلي في لوحة التحكم — ردي بإيجاز دقيق.`;
  } else {
    system = `${PERSONA_SYSTEM_PROMPT}\n\n## سياق المتجر\nاللهجة: ${dialect}\nتعليمات المتجر: ${instructions || "لا توجد تعليمات إضافية"}${ragContext}`;
  }

  const rawReply = await askWorkersAI({
    env,
    system,
    messages: [{ role: "user", content: message }],
    maxTokens: 250,
    model: TEXT_MODEL
  });

  const reply = cleanOutputReply(rawReply);

  return {
    ok: true,
    storeId,
    reply,
    source: "ai_cascade",
    ragHits: memories.length,
    dialect
  };
}

export const onRequestPost = withApi(sandboxHandler);

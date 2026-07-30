// POST /api/store/ingest
// Automated RAG Knowledge Ingestion Endpoint for Stores
import { withApi } from "../../_lib/core/respond.js";
import { rememberReply } from "../../_lib/ai/memory.js";
import { resolveStoreId } from "../../_lib/core/session.js";

async function ingestHandler(body, env, request) {
  const storeId = await resolveStoreId(request, env, body.storeId);
  const items = Array.isArray(body.items) ? body.items : [];

  if (!items.length) {
    return { ok: false, error: "لا يوجد عناصر للسحب والإدخال" };
  }

  let ingested = 0;
  for (const item of items) {
    const question = String(item.question || item.title || "").trim();
    const reply = String(item.answer || item.description || item.content || "").trim();
    if (question && reply) {
      await rememberReply({
        env,
        storeId,
        question,
        reply,
        score: item.score || 10,
        dialect: item.dialect || "saudi_najdi"
      }).catch(() => {});
      ingested++;
    }
  }

  return {
    ok: true,
    storeId,
    ingestedCount: ingested,
    status: "RAG knowledge base successfully synced"
  };
}

export const onRequestPost = withApi(ingestHandler);

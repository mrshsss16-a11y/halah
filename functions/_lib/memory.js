// Episodic memory for the marketer persona on Cloudflare Vectorize — the
// Workers-native equivalent of the old Upstash Vector integration. Vectorize
// (unlike Upstash) needs pre-computed embedding vectors, not raw text, so
// every insert/query goes through embedText() first (functions/_lib/workersAI.js).
// Store isolation uses a metadata filter instead of a namespace.
import { embedText } from "./workersAI.js";

export async function rememberReply({ env, storeId, question, reply, score, dialect }) {
  if (!env.VECTORIZE_INDEX) return null;
  const values = await embedText({ env, text: question });
  const id = `${storeId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  await env.VECTORIZE_INDEX.insert([
    {
      id,
      values,
      metadata: { question, reply, score, dialect, storeId, ts: Date.now() }
    }
  ]);
  return id;
}

export async function recallSimilar({ env, storeId, question, topK = 3 }) {
  if (!env.VECTORIZE_INDEX) return [];
  const values = await embedText({ env, text: question });
  const result = await env.VECTORIZE_INDEX.query(values, {
    topK,
    returnMetadata: "all",
    filter: { storeId: { $eq: storeId } }
  });
  const matches = (result && result.matches) || [];
  return matches
    .map((m) => m.metadata)
    .filter((m) => Boolean(m) && (m.score === undefined || m.score >= 6));
}

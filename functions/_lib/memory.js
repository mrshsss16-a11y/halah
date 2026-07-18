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

/**
 * Re-embeds every row in D1's hala_faq table into Vectorize under
 * storeId="hala", so the WhatsApp/support personas can recallSimilar()
 * against it exactly like a merchant's memory. Deterministic ids
 * (hala_faq_<row id>) mean a re-run overwrites in place — no separate
 * delete pass needed.
 */
export async function reembedHalaFaq(env, faqRows) {
  if (!env.VECTORIZE_INDEX) return 0;
  let count = 0;
  for (const row of faqRows) {
    const values = await embedText({ env, text: row.question });
    await env.VECTORIZE_INDEX.upsert([
      {
        id: `hala_faq_${row.id}`,
        values,
        metadata: {
          question: row.question,
          reply: row.answer,
          score: 10,
          dialect: "saudi_najdi",
          storeId: "hala",
          ts: Date.now()
        }
      }
    ]);
    count++;
  }
  return count;
}

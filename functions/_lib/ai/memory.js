// Episodic memory for the marketer persona on Cloudflare Vectorize — the
// Workers-native equivalent of the old Upstash Vector integration. Vectorize
// (unlike Upstash) needs pre-computed embedding vectors, not raw text, so
// every insert/query goes through embedText() first (functions/_lib/workersAI.js).
// Store isolation uses a metadata filter instead of a namespace.
import { embedText } from "./gateway.js";

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

export async function storeVectorMemory({ env, storeId, text, metadata = {} }) {
  if (!env?.VECTORIZE_INDEX) return null;
  const values = await embedText({ env, text });
  const id = `${storeId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  await env.VECTORIZE_INDEX.insert([
    {
      id,
      values,
      metadata: { text, storeId, ...metadata, ts: Date.now() }
    }
  ]);
  return id;
}

export async function recallSimilar({ env, storeId, question, topK = 5 }) {
  if (!env.VECTORIZE_INDEX) return [];
  const values = await embedText({ env, text: question });
  const result = await env.VECTORIZE_INDEX.query(values, {
    topK,
    returnMetadata: "all",
    filter: { storeId: { $eq: storeId } }
  });
  const matches = result?.matches ?? [];
  return matches
    .map((m) => m?.metadata)
    .filter((m) => m && (m?.score === undefined || m?.score >= 6));
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

// ── Style library: real successful product descriptions, cross-merchant ──
// Not tied to any single storeId — this is reference material for HOW a
// good description reads in a given category (عبايات, عطور, ...), used to
// steer copy.js's tone/structure toward proven real writing instead of
// generic AI phrasing. Lives in the same Vectorize index under a fixed
// pseudo-store id so it never collides with a real merchant's memory
// (storeId values for real merchants are "m_..." or "hala").
const STYLE_LIBRARY_STORE_ID = "style_library";

export async function storeStyleExample({ env, category, text, note }) {
  if (!env?.VECTORIZE_INDEX || !category || !text) return null;
  const values = await embedText({ env, text });
  const id = `style:${category}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  await env.VECTORIZE_INDEX.insert([
    {
      id,
      values,
      metadata: { storeId: STYLE_LIBRARY_STORE_ID, category: String(category), text, note: note || "", ts: Date.now() }
    }
  ]);
  return id;
}

/**
 * Top-k real examples ranked by similarity to the current product's
 * category+name+features. Deliberately NOT filtered by an exact category
 * match — a merchant's free-typed category ("عطور رجالية") will rarely
 * string-match the library's category label ("عطور") exactly, so semantic
 * similarity across the whole library (still scoped to storeId so it never
 * mixes with a real merchant's own memory) does the matching instead.
 */
export async function recallStyleExamples({ env, category, productContext, topK = 3 }) {
  if (!env?.VECTORIZE_INDEX || !category) return [];
  const values = await embedText({ env, text: `${category} ${productContext || ""}`.trim() });
  const result = await env.VECTORIZE_INDEX.query(values, {
    topK,
    returnMetadata: "all",
    filter: { storeId: { $eq: STYLE_LIBRARY_STORE_ID } }
  });
  const matches = result?.matches ?? [];
  return matches.map((m) => m?.metadata).filter(Boolean);
}

/**
 * Removes the Vectorize embedding for a single deleted hala_faq row so
 * recallSimilar() stops surfacing an answer that no longer exists in D1.
 * Must be called whenever a row is deleted, since reembedHalaFaq only
 * upserts current rows and never prunes stale ones.
 */
export async function deleteHalaFaqEmbedding(env, id) {
  if (!env.VECTORIZE_INDEX) return;
  await env.VECTORIZE_INDEX.deleteByIds([`hala_faq_${id}`]);
}

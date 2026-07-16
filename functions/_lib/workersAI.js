// Single Workers AI model for every text task (chat, critic, copywriting) —
// keeps cost/neuron usage minimal per the user's explicit "free or cheapest
// possible" requirement, instead of mixing model tiers like the old
// Anthropic version did.
const TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const EMBED_MODEL = "@cf/baai/bge-m3";

/**
 * @param {object} opts
 * @param {any} opts.env - Pages Functions env (must have AI binding)
 * @param {string} opts.system
 * @param {{role:"user"|"assistant", content:string}[]} opts.messages
 * @param {number} [opts.maxTokens]
 */
export async function askWorkersAI({ env, system, messages, maxTokens = 512 }) {
  if (!env.AI) {
    throw new Error("AI binding is missing — add [ai] binding = \"AI\" to wrangler.toml and configure it on the Pages project.");
  }
  const response = await env.AI.run(TEXT_MODEL, {
    messages: [{ role: "system", content: system }, ...messages],
    max_tokens: maxTokens
  });
  return (response && response.response ? response.response : "").trim();
}

/** Returns a float32 embedding vector (1024-dim) for RAG storage/search. */
export async function embedText({ env, text }) {
  if (!env.AI) {
    throw new Error("AI binding is missing.");
  }
  const response = await env.AI.run(EMBED_MODEL, { text: [text] });
  const vector = response && response.data && response.data[0];
  if (!Array.isArray(vector)) {
    throw new Error("embedding model returned no vector");
  }
  return vector;
}

export { TEXT_MODEL, EMBED_MODEL };

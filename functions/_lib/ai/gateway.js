// AI inference gateway — four-tier cascade, zero cost by design:
//
//   Tier 1 — Cloudflare Workers AI (on-edge, free 10,000 neurons/day)
//   Tier 2 — Groq API fallback     (14,400 free req/day, fastest inference globally)
//   Tier 3 — OpenRouter free models (no fixed daily cap, llama-3.3-70b:free)
//   Tier 4 — DeepSeek API (deepseek-chat / V3 & R1 high-reasoning ultra-low cost)
//
// Before hitting any AI tier, responses are looked up in KV cache (HALA_CACHE).
// Semantically identical questions (same store + same normalized text) return the
// cached reply instantly — no neuron cost, no API round-trip.
// Cache TTL: 24h for product descriptions, 15min for support chat.
//
// Required secrets:
//   GROQ_API_KEY       — console.groq.com (free tier: 14,400 req/day)
//   OPENROUTER_API_KEY — openrouter.ai    (free models: unlimited via rate-limit)
//   DEEPSEEK_API_KEY   — platform.deepseek.com ($0.14/1M input tokens)

// ── Model constants ─────────────────────────────────────────────────────────
export const TEXT_MODEL      = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const FAST_TEXT_MODEL = "@cf/meta/llama-3.2-3b-instruct";
export const EMBED_MODEL     = "@cf/baai/bge-m3";

// Groq mirrors (OpenAI-compatible)
const GROQ_API_URL   = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL     = "llama-3.3-70b-versatile";

// OpenRouter free-tier (completely free, rate-limited not quota-capped)
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL   = "meta-llama/llama-3.3-70b-instruct:free";

// DeepSeek API (ultra-low cost). "deepseek-chat" was retired 2026-07-24 — every
// call through this tier was silently failing and falling through to "no AI
// backend available" until this was caught (2026-08-07 capacity audit).
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL   = "deepseek-v4-flash";

// ── KV cache helpers ────────────────────────────────────────────────────────
const CACHE_TTL_COPY    = 60 * 60 * 24;     // 24h — product descriptions rarely change
const CACHE_TTL_CHAT    = 60 * 15;           // 15min — support replies should feel fresh
const CACHE_TTL_DEFAULT = 60 * 30;           // 30min — default

/**
 * Build a deterministic KV cache key from the last user turn + system fingerprint.
 * We don't use the full conversation — only the final question matters for lookup.
 */
function buildCacheKey(storeId, system, messages) {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  // Simple 64-char fingerprint: storeId + first 20 chars of system + normalized question
  const sysSnippet = system.slice(0, 20).replace(/\s+/g, "_");
  const q = lastUserMsg.trim().slice(0, 80).replace(/\s+/g, "_");
  return `ai_cache:${storeId ?? "global"}:${sysSnippet}:${q}`;
}

function selectTtl(system) {
  if (/وصف|منتج|copy/i.test(system)) return CACHE_TTL_COPY;
  if (/واتساب|دعم|support/i.test(system)) return CACHE_TTL_CHAT;
  return CACHE_TTL_DEFAULT;
}

// ── Groq fallback (Tier 2) ───────────────────────────────────────────────────
async function askGroq({ apiKey, system, messages, maxTokens }) {
  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "system", content: system }, ...messages],
      max_tokens: maxTokens,
      temperature: 0.7
    })
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.status);
    throw new Error(`Groq ${res.status}: ${err}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  return String(text ?? "").trim();
}

// ── OpenRouter fallback (Tier 3 — fully free) ────────────────────────────────
async function askOpenRouter({ apiKey, system, messages, maxTokens }) {
  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://hala-ai-os.pages.dev",
      "X-Title": "Hala AI OS"
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: "system", content: system }, ...messages],
      max_tokens: maxTokens,
      temperature: 0.7
    })
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.status);
    throw new Error(`OpenRouter ${res.status}: ${err}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  return String(text ?? "").trim();
}

// ── DeepSeek fallback (Tier 4 — V3 / R1 High Reasoning) ─────────────────────
async function askDeepSeek({ apiKey, system, messages, maxTokens }) {
  const res = await fetch(DEEPSEEK_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [{ role: "system", content: system }, ...messages],
      max_tokens: maxTokens,
      temperature: 0.7
    })
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.status);
    throw new Error(`DeepSeek ${res.status}: ${err}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  return String(text ?? "").trim();
}

// ── Main gateway ─────────────────────────────────────────────────────────────
/**
 * Ask the AI with automatic four-tier fallback + KV response caching.
 *
 * @param {object} opts
 * @param {any}    opts.env        - Pages Functions env
 * @param {string} opts.system     - System prompt
 * @param {{role:"user"|"assistant", content:string}[]} opts.messages
 * @param {number} [opts.maxTokens=512]
 * @param {string} [opts.model]    - Workers AI model override
 * @param {string} [opts.storeId] - Used to scope KV cache key (optional)
 * @param {boolean} [opts.skipCache=false] - Bypass cache for one-off sensitive turns
 */
export async function askWorkersAI({
  env,
  system,
  messages,
  maxTokens = 512,
  model = TEXT_MODEL,
  storeId = "global",
  skipCache = false
}) {
  const cacheKey = buildCacheKey(storeId, system, messages);
  const ttl      = selectTtl(system);

  // ── KV cache READ ──────────────────────────────────────────────────────────
  if (!skipCache && env.HALA_CACHE) {
    try {
      const cached = await env.HALA_CACHE.get(cacheKey);
      if (cached) {
        console.log("[ai-gateway] cache HIT:", cacheKey.slice(0, 60));
        return cached;
      }
    } catch (e) {
      console.warn("[ai-gateway] KV read error (non-fatal):", e?.message);
    }
  }

  let result = null;

  // ── Tier 1: Cloudflare Workers AI ─────────────────────────────────────────
  if (env.AI) {
    try {
      const response = await env.AI.run(model, {
        messages: [{ role: "system", content: system }, ...messages],
        max_tokens: maxTokens
      });
      const raw = response?.response;
      const text = (typeof raw === "string" ? raw : raw ? JSON.stringify(raw) : "").trim();
      if (text) {
        result = text;
        console.log("[ai-gateway] Tier 1 (Workers AI) succeeded.");
      }
    } catch (e) {
      console.warn("[ai-gateway] Tier 1 failed → trying Groq:", e?.message);
    }
  }

  // ── Tier 2: Groq (free 14,400 req/day) ────────────────────────────────────
  if (!result && env.GROQ_API_KEY) {
    try {
      result = await askGroq({ apiKey: env.GROQ_API_KEY, system, messages, maxTokens });
      console.log("[ai-gateway] Tier 2 (Groq) succeeded.");
    } catch (e) {
      console.warn("[ai-gateway] Tier 2 failed → trying OpenRouter:", e?.message);
    }
  }

  // ── Tier 3: OpenRouter free model (no quota cap) ──────────────────────────
  if (!result && env.OPENROUTER_API_KEY) {
    try {
      result = await askOpenRouter({ apiKey: env.OPENROUTER_API_KEY, system, messages, maxTokens });
      console.log("[ai-gateway] Tier 3 (OpenRouter free) succeeded.");
    } catch (e) {
      console.warn("[ai-gateway] Tier 3 failed → trying DeepSeek:", e?.message);
    }
  }

  // ── Tier 4: DeepSeek V3 / R1 (High reasoning, ultra-low cost) ─────────────
  if (!result && env.DEEPSEEK_API_KEY) {
    try {
      result = await askDeepSeek({ apiKey: env.DEEPSEEK_API_KEY, system, messages, maxTokens });
      console.log("[ai-gateway] Tier 4 (DeepSeek V3/R1) succeeded.");
    } catch (e) {
      console.error("[ai-gateway] All four AI tiers failed:", e?.message);
      throw e;
    }
  }

  if (!result) {
    throw new Error(
      "No AI backend available. Configure at least one of: Workers AI binding, GROQ_API_KEY, OPENROUTER_API_KEY, or DEEPSEEK_API_KEY."
    );
  }

  // ── KV cache WRITE ─────────────────────────────────────────────────────────
  if (!skipCache && env.HALA_CACHE) {
    try {
      await env.HALA_CACHE.put(cacheKey, result, { expirationTtl: ttl });
    } catch (e) {
      console.warn("[ai-gateway] KV write error (non-fatal):", e?.message);
    }
  }

  return result;
}

// ── Embedding (unchanged, Workers AI only) ────────────────────────────────────
/** Returns a float32 embedding vector (1024-dim) for RAG storage/search. */
export async function embedText({ env, text }) {
  if (!env.AI) throw new Error("AI binding is missing.");
  const response = await env.AI.run(EMBED_MODEL, { text: [text] });
  const vector = response?.data?.[0];
  if (!Array.isArray(vector)) throw new Error("embedding model returned no vector");
  return vector;
}

// ── Vision AI ────────────────────────────────────────────────────────────────
/**
 * Ask the Vision AI model using Cloudflare Workers AI.
 * 
 * @param {object} opts
 * @param {any}    opts.env        - Pages Functions env
 * @param {string} [opts.imageUrl] - Public URL of the image
 * @param {ArrayBuffer} [opts.imageBuffer] - Raw image buffer (useful for private WhatsApp media)
 * @param {string} opts.prompt     - The prompt to ask about the image
 */
export async function askVisionAI({ env, imageUrl, imageBuffer, prompt }) {
  if (!env.AI) throw new Error("AI binding is missing.");
  
  let buffer = imageBuffer;
  if (!buffer && imageUrl) {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
    buffer = await res.arrayBuffer();
  }
  
  if (!buffer) throw new Error("No image provided");

  const response = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
    prompt: prompt || "صف هذه الصورة بدقة.",
    image: [...new Uint8Array(buffer)]
  });

  const raw = response?.response;
  return (typeof raw === "string" ? raw : raw ? JSON.stringify(raw) : "").trim();
}

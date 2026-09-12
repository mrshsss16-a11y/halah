// سلسلة احتياط الذكاء الاصطناعي — عطل حقيقي 2026-09-12 00:47 UTC: نفدت حصة Workers AI اليومية،
// ونموذج OpenRouter المجاني سُحب (404)، والسجل حفظ خطأ الطبقة الأخيرة وحده.
import { readFileSync } from "node:fs";
import { createRunner } from "../_helpers.mjs";
import { askWorkersAI } from "../../functions/_lib/ai/gateway.js";

const { assert, done } = createRunner("ai-fallback");

const QUOTA = "4006: you have used up your daily free allocation of 10,000 neurons";

async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

async function captureConsole(fn) {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.map(String).join(" "));
  try { await fn(); } catch { /* يُفحص بالسطور */ } finally { Object.assign(console, orig); }
  return lines;
}

const baseEnv = () => ({
  AI: { run: async () => { throw new Error(QUOTA); } },
  GROQ_API_KEY: "test-groq",
  OPENROUTER_API_KEY: "test-openrouter"
});

async function main() {
  {
    const models = [];
    const text = await withFetch(async (url, init) => {
      if (String(url).includes("groq")) return new Response("rate limited", { status: 429 });
      const model = JSON.parse(init.body).model;
      models.push(model);
      if (models.length === 1) return new Response('{"error":{"message":"This model is unavailable for free"}}', { status: 404 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "وصف احتياطي" } }] }), { status: 200 });
    }, () => askWorkersAI({ env: baseEnv(), system: "s", messages: [{ role: "user", content: "u" }], skipCache: true }));
    assert(text === "وصف احتياطي" && models.length === 2 && models[0] !== models[1], `AF-1: نموذج OpenRouter المسحوب (404) يُتجاوز إلى التالي بدل سقوط الطبقة (${models.join(", ")})`);
  }
  {
    const lines = await captureConsole(() => withFetch(async (url) => {
      if (String(url).includes("groq")) return new Response("groq quota", { status: 429 });
      return new Response('{"error":{"message":"This model is unavailable for free"}}', { status: 404 });
    }, () => askWorkersAI({ env: baseEnv(), system: "s", messages: [{ role: "user", content: "u" }], skipCache: true })));
    const failed = lines.find((l) => l.includes("AI_ALL_TIERS_FAILED")) || "";
    assert(/workers-ai: 4006/.test(failed) && /groq: Groq 429/.test(failed) && /openrouter: OpenRouter/.test(failed), `AF-2: سجل AI_ALL_TIERS_FAILED يحفظ سبب فشل كل طبقة لا الأخيرة وحدها («${failed.slice(0, 300)}»)`);
  }
  {
    const src = readFileSync(new URL("../../functions/_lib/core/rateLimit.js", import.meta.url), "utf8");
    assert(/expirationTtl: Math\.max\(60, ttl\)/.test(src), "AF-3: عمر مفتاح حد الطلبات لا يقل عن ٦٠ ثانية (KV رفض ٥٢ فسقط الفحص مفتوحاً)");
  }
}

main().then(done);

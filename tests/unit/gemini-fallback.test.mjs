// مزوّد Gemini الاحتياطي (2026-09-12) — ترتيب الطبقات وصيغة الطلب والتصنيف.
import { readFileSync } from "node:fs";
import { createRunner } from "../_helpers.mjs";
import { askWorkersAI } from "../../functions/_lib/ai/gateway.js";
import { askVisionDetailed, GEMINI_API_URL } from "../../functions/_lib/ai/vision.js";
import { classifyError } from "../../functions/_lib/core/errors.js";

const { assert, done } = createRunner("gemini-fallback");
const QUOTA = "4006: you have used up your daily free allocation of 10,000 neurons";
const ok = (text) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });

async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => handler(String(url), init);
  try { return await fn(); } finally { globalThis.fetch = real; }
}

async function main() {
  {
    const calls = [];
    const diag = {};
    const text = await withFetch(async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.Authorization });
      if (url.includes("groq")) return new Response("rate limited", { status: 429 });
      if (url === GEMINI_API_URL) return ok("رد من Gemini");
      return new Response("should not reach openrouter", { status: 500 });
    }, () => askWorkersAI({ env: { AI: { run: async () => { throw new Error(QUOTA); } }, GROQ_API_KEY: "g", GEMINI_API_KEY: "k", OPENROUTER_API_KEY: "o" }, system: "s", messages: [{ role: "user", content: "u" }], skipCache: true, maxTokens: 800, diag }));
    const gem = calls.find((c) => c.url === GEMINI_API_URL);
    assert(text === "رد من Gemini" && diag.tier === "gemini" && !calls.some((c) => c.url.includes("openrouter")), "GF-1: Gemini بعد Groq وقبل OpenRouter بسلسلة النص");
    assert(gem?.body?.model === "gemini-2.5-flash" && gem?.body?.reasoning_effort === "none" && gem?.body?.max_tokens === 800 && gem?.auth === "Bearer k", "GF-2: أول نموذج 2.5 Flash بتفكير موقوف ومفتاح Bearer");
  }
  {
    const models = [];
    const text = await withFetch(async (url, init) => {
      if (url !== GEMINI_API_URL) return new Response("no", { status: 500 });
      const b = JSON.parse(init.body);
      models.push([b.model, b.reasoning_effort, b.max_tokens]);
      return models.length === 1 ? new Response('{"error":{"message":"model not found"}}', { status: 404 }) : ok("رد 3.8");
    }, () => askWorkersAI({ env: { GEMINI_API_KEY: "k" }, system: "s", messages: [{ role: "user", content: "u" }], skipCache: true, maxTokens: 1000 }));
    assert(text === "رد 3.8" && models[1][0] === "gemini-3.8-flash" && models[1][1] === "low" && models[1][2] === 2500, `GF-3: 3.8 Flash احتياطاً بتفكير منخفض ورموز إضافية (${JSON.stringify(models)})`);
  }
  {
    let thrown = null;
    await withFetch(async () => new Response('{"error":{"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: GenerateRequestsPerDayPerProjectPerModel-FreeTier"}}', { status: 429 }),
      () => askWorkersAI({ env: { GEMINI_API_KEY: "k" }, system: "s", messages: [{ role: "user", content: "u" }], skipCache: true }).catch((e) => { thrown = e; }));
    assert(/gemini: Gemini/.test(String(thrown?.message)) && classifyError(thrown) === "AI_QUOTA_DAILY", `GF-4: بلا OpenRouter يصل خطأ Gemini بسببه، وحصته اليومية تُصنَّف يومية («${String(thrown?.message).slice(0, 90)}»)`);
  }
  {
    const IMAGE = "https://cdn.example.com/p.jpg";
    const order = [];
    const out = await withFetch(async (url, init) => {
      if (url === IMAGE) return new Response(new Uint8Array([255, 216, 255, 224]), { status: 200, headers: { "content-type": "image/jpeg" } });
      const b = JSON.parse(init.body);
      order.push(b.model);
      if (url.includes("groq")) return new Response("rate limited", { status: 429 });
      if (url === GEMINI_API_URL) return ok("اللون: أسود.");
      return new Response("no", { status: 500 });
    }, () => askVisionDetailed({ env: { AI: { run: async () => { throw new Error(QUOTA); } }, GROQ_API_KEY: "g", GEMINI_API_KEY: "k", OPENROUTER_API_KEY: "o" }, imageUrl: IMAGE, prompt: "صف" }));
    assert(out.text === "اللون: أسود." && out.model === "gemini:gemini-2.5-flash" && order[0] === "qwen/qwen3.8-27b" && order[1] === "gemini-2.5-flash", `GF-5: الرؤية Groq ثم Gemini قبل OpenRouter (${order.join(" > ")})`);
  }
  {
    const privacy = readFileSync(new URL("../../privacy.html", import.meta.url), "utf8").replace(/\s+/g, " ");
    assert(/Google \(Gemini API\)/.test(privacy) && /قد تستخدم Google المحتوى المُرسل لتحسين خدماتها/.test(privacy), "GF-6: الخصوصية تسمّي Gemini وتفصح عن استخدام Google للمحتوى بالطبقة المجانية");
  }
}

main().then(done);

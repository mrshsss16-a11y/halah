// احتياط الرؤية الخارجي — قرار المالك 2026-09-12 بعد نفاد حصة Workers AI اليومية المجانية:
// Groq (Qwen 3.8 نفسه) ثم نماذج OpenRouter المجانية التي تقبل الصور.
import { createRunner } from "../_helpers.mjs";
import { askVisionDetailed } from "../../functions/_lib/ai/vision.js";

const { assert, done } = createRunner("vision-fallback");

const QUOTA = "4006: you have used up your daily free allocation of 10,000 neurons";
const IMAGE = "https://cdn.example.com/dress.jpg";

async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url) === IMAGE) return new Response(new Uint8Array([255, 216, 255, 224]), { status: 200, headers: { "content-type": "image/jpeg" } });
    return handler(String(url), init);
  };
  try { return await fn(); } finally { globalThis.fetch = real; }
}

const quotaAI = { run: async () => { throw new Error(QUOTA); } };
const ok = (text) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });

async function main() {
  {
    let groqBody = null;
    const out = await withFetch(async (url, init) => {
      if (url.includes("groq")) { groqBody = JSON.parse(init.body); return ok("اللون: أسود."); }
      return new Response("unexpected", { status: 500 });
    }, () => askVisionDetailed({ env: { AI: quotaAI, GROQ_API_KEY: "g", OPENROUTER_API_KEY: "o" }, imageUrl: IMAGE, prompt: "صف" }));
    const image = groqBody?.messages?.[0]?.content?.find((p) => p.type === "image_url")?.image_url?.url || "";
    assert(out.text === "اللون: أسود." && out.model === "groq:qwen/qwen3.8-27b", `VF-1: نفاد حصة Cloudflare يسقط لتحليل الصورة على Groq (${out.model})`);
    assert(groqBody?.model === "qwen/qwen3.8-27b" && groqBody?.reasoning_effort === "none" && image.startsWith("data:image/jpeg;base64,"), "VF-2: Groq يستلم Qwen 3.8 نفسه بلا تفكير والصورة data URI");
    assert(out.errors.some((e) => /4006/.test(e)), "VF-3: سبب فشل Cloudflare يبقى بالتشخيص");
  }
  {
    const seen = [];
    const out = await withFetch(async (url, init) => {
      if (url.includes("groq")) return new Response("rate limited", { status: 429 });
      const model = JSON.parse(init.body).model;
      seen.push(model);
      if (seen.length === 1) return new Response('{"error":{"message":"unavailable"}}', { status: 404 });
      return ok("اللون: وردي فاتح.");
    }, () => askVisionDetailed({ env: { AI: quotaAI, GROQ_API_KEY: "g", OPENROUTER_API_KEY: "o" }, imageUrl: IMAGE, prompt: "صف" }));
    assert(out.text === "اللون: وردي فاتح." && out.model === "openrouter:google/gemma-4-26b-a4b-it:free" && seen.length === 2, `VF-4: فشل Groq ثم نموذج OpenRouter الأول يسقط للثاني (${out.model})`);
    assert(out.errors.some((e) => /^groq:.*429/.test(e)) && out.errors.some((e) => /^openrouter:google\/gemma-4-31b-it:free: 404/.test(e)), "VF-5: سبب فشل كل طبقة خارجية بالتشخيص");
  }
  {
    const out = await withFetch(async () => new Response("no", { status: 500 }), () => askVisionDetailed({ env: { AI: quotaAI }, imageUrl: IMAGE, prompt: "صف" }));
    assert(out.text === "" && out.model === null, "VF-6: بلا مفاتيح خارجية يبقى السلوك كما كان — نص فارغ وتشخيص");
  }
  {
    const out = await withFetch(async (url) => (url.includes("groq") ? ok("اللون: أبيض.") : new Response("no", { status: 500 })),
      () => askVisionDetailed({ env: { GROQ_API_KEY: "g" }, imageUrl: IMAGE, prompt: "صف" }));
    assert(out.text === "اللون: أبيض.", "VF-7: غياب ربط Cloudflare لا يرمي خطأ ما دام مزوّد خارجي مضبوطاً");
  }
}

main().then(done);

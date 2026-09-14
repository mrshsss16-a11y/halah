// طبقة nexos.ai المدفوعة (2026-09-13): آخر خيار بعد المجاني (قرار المالك) للرؤية وكتابة الأوصاف، بسقف يومي، والمحادثة مجانية.
import { readFileSync } from "node:fs";
import { createRunner } from "../_helpers.mjs";
import { askWorkersAI } from "../../functions/_lib/ai/gateway.js";
import { askVisionDetailed } from "../../functions/_lib/ai/vision.js";
import { NEXOS_API_URL, NEXOS_DAILY_CALLS, reserveNexosCall } from "../../functions/_lib/ai/nexos.js";

const { assert, done } = createRunner("nexos-tier");
const IMAGE = "https://cdn.example.com/dress.jpg";
const ok = (text) => new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: "stop" }] }), { status: 200 });
const kv = (init = {}) => { const m = new Map(Object.entries(init)); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, map: m }; };
const day = () => new Date().toISOString().slice(0, 10);
const neverAI = { run: async () => { throw new Error("workers ai should not run"); } };

async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url) === IMAGE) return new Response(new Uint8Array([255, 216, 255, 224]), { status: 200, headers: { "content-type": "image/jpeg" } });
    return handler(String(url), init);
  };
  try { return await fn(); } finally { globalThis.fetch = real; }
}

async function main() {
  {
    let body = null;
    const cache = kv();
    const out = await withFetch(async (url, init) => { if (url === NEXOS_API_URL) { body = JSON.parse(init.body); return ok("اللون: أسود."); } return new Response("no", { status: 500 }); },
      () => askVisionDetailed({ env: { AI: neverAI, GROQ_API_KEY: "g", NEXOS_API_KEY: "n", HALA_CACHE: cache }, imageUrl: IMAGE, prompt: "صف" }));
    const image = body?.messages?.[0]?.content?.find((p) => p.type === "image_url")?.image_url?.url || "";
    assert(out.text === "اللون: أسود." && out.model === "nexos:GPT 5.6 Luna", `NX-1: الرؤية تصل nexos بعد فشل Cloudflare وGroq (${out.model})`);
    assert(body?.reasoning_effort === "low" && body?.temperature === undefined && body?.max_tokens === 1700 && image.startsWith("data:image/jpeg;base64,"), "NX-2: الرؤية بتفكير منخفض ورموز إضافية وبلا حرارة (Luna يرفضها مع التفكير)");
    assert(cache.map.get(`nexos:calls:${day()}`) === "1", "NX-3: كل نداء يُحتسب بعدّاد اليوم");
  }
  {
    const cache = kv();
    const urls = [];
    const out = await withFetch(async (url) => { urls.push(url); return url.includes("groq") ? ok("اللون: كحلي.") : new Response("no", { status: 500 }); },
      () => askVisionDetailed({ env: { NEXOS_API_KEY: "n", GROQ_API_KEY: "g", HALA_CACHE: cache }, imageUrl: IMAGE, prompt: "صف" }));
    assert(out.text === "اللون: كحلي." && !urls.includes(NEXOS_API_URL) && !cache.map.size, "NX-3b: نجاح طبقة مجانية يمنع أي صرف من الرصيد");
  }
  {
    const cache = kv({ [`nexos:calls:${day()}`]: String(NEXOS_DAILY_CALLS) });
    const urls = [];
    const out = await withFetch(async (url) => { urls.push(url); return url.includes("groq") ? ok("اللون: أبيض.") : new Response("no", { status: 500 }); },
      () => askVisionDetailed({ env: { NEXOS_API_KEY: "n", GROQ_API_KEY: "g", HALA_CACHE: cache }, imageUrl: IMAGE, prompt: "صف" }));
    assert(out.text === "اللون: أبيض." && !urls.includes(NEXOS_API_URL), "NX-4: بلوغ السقف اليومي يسقط للطبقات المجانية بلا نداء مدفوع");
  }
  {
    const out = await withFetch(async (url) => (url === NEXOS_API_URL ? new Response("insufficient credit", { status: 402 }) : new Response("no", { status: 500 })),
      () => askVisionDetailed({ env: { NEXOS_API_KEY: "n", GROQ_API_KEY: "g", HALA_CACHE: kv() }, imageUrl: IMAGE, prompt: "صف" }));
    assert(out.text === "" && out.errors.some((e) => /^nexos:GPT 5\.6 Luna: nexos GPT 5\.6 Luna: 402.*GLM 5\.3 Flash: 402/.test(e)), `NX-5: فشل nexos (نفاد الرصيد) بالنموذجين يعيد نصاً فارغاً وسببه بالتشخيص (${out.errors.at(-1)})`);
  }
  {
    const seen = [];
    const out = await withFetch(async (url, init) => {
      if (url !== NEXOS_API_URL) return new Response("no", { status: 500 });
      const b = JSON.parse(init.body);
      seen.push([b.model, b.reasoning_effort, b.temperature]);
      return seen.length === 1 ? new Response("overloaded", { status: 503 }) : ok("اللون: بيج.");
    }, () => askVisionDetailed({ env: { NEXOS_API_KEY: "n", HALA_CACHE: kv() }, imageUrl: IMAGE, prompt: "صف" }));
    assert(out.text === "اللون: بيج." && seen[1]?.[0] === "GLM 5.3 Flash" && seen[1]?.[1] === "low" && seen[1]?.[2] === undefined, `NX-5b: تعذّر Luna يسقط لـGLM 5.3 Flash بتفكير منخفض (${JSON.stringify(seen)})`);
  }
  assert(await reserveNexosCall({ NEXOS_API_KEY: "n" }) === false && await reserveNexosCall({ HALA_CACHE: kv() }) === false, "NX-6: بلا KV أو بلا مفتاح لا صرف — حماية الرصيد تفشل مغلقة");
  {
    let body = null;
    const diag = {};
    let freeCalled = false;
    const text = await withFetch(async (url, init) => { if (url === NEXOS_API_URL) { body = JSON.parse(init.body); return ok("{\"description\":\"وصف\"}"); } return new Response("no", { status: 500 }); },
      () => askWorkersAI({ env: { AI: { run: async () => { freeCalled = true; return { response: "مجاني" }; } }, NEXOS_API_KEY: "n", HALA_CACHE: kv() }, system: "s", messages: [{ role: "user", content: "u" }], skipCache: true, maxTokens: 2400, ttlKind: "copy", temperature: 0.35, diag }));
    assert(text === "{\"description\":\"وصف\"}" && diag.tier === "nexos" && !freeCalled, "NX-7: كتابة الوصف تبدأ بـnexos (Luna) قبل المجاني — قرار المالك 2026-09-14");
    assert(body?.reasoning_effort === "none" && body?.temperature === 0.35 && body?.max_tokens === 2400 && body?.messages?.[0]?.role === "system", "NX-8: الكتابة بلا تفكير وبحرارة الوصف ورسالة النظام");
  }
  {
    const urls = [];
    const diag = {};
    await withFetch(async (url) => { urls.push(url); return new Response("no", { status: 500 }); },
      () => askWorkersAI({ env: { AI: { run: async () => ({ response: "رد دعم" }) }, NEXOS_API_KEY: "n", HALA_CACHE: kv() }, system: "s", messages: [{ role: "user", content: "u" }], skipCache: true, ttlKind: "chat", diag }));
    assert(!urls.includes(NEXOS_API_URL) && diag.tier === "workers-ai", "NX-9: المحادثة والدعم لا تصرف من الرصيد");
  }
  {
    const urls = [];
    await withFetch(async (url) => { urls.push(url); return new Response("no", { status: 500 }); },
      () => askWorkersAI({ env: { AI: { run: async () => ({ response: "{\"description\":\"مجاني\"}" }) }, NEXOS_API_KEY: "n", HALA_CACHE: kv({ [`nexos:calls:${day()}`]: String(NEXOS_DAILY_CALLS) }) }, system: "s", messages: [{ role: "user", content: "u" }], skipCache: true, ttlKind: "copy" }));
    assert(!urls.includes(NEXOS_API_URL), "NX-9b: بعد السقف اليومي يكتب المجاني ولا يُصرف من الرصيد");
    let thrown = null;
    await withFetch(async () => new Response("no", { status: 500 }),
      () => askWorkersAI({ env: { AI: neverAI, NEXOS_API_KEY: "n", HALA_CACHE: kv({ [`nexos:calls:${day()}`]: String(NEXOS_DAILY_CALLS) }) }, system: "s", messages: [{ role: "user", content: "u" }], skipCache: true, ttlKind: "copy" }).catch((e) => { thrown = e; }));
    assert(/workers-ai: workers ai should not run/.test(String(thrown?.message)), "NX-9c: بعد السقف وفشل المجاني يصل خطأ بأسباب الطبقات لا صمت");
  }
  {
    const privacy = readFileSync(new URL("../../privacy.html", import.meta.url), "utf8").replace(/\s+/g, " ");
    const transfer = readFileSync(new URL("../../docs/PDPL/TRANSFER_RISK_ASSESSMENT.md", import.meta.url), "utf8");
    assert(/nexos\.ai/.test(privacy) && /Azure/.test(privacy) && /ثم OpenRouter ثم nexos\.ai/.test(privacy) && /nexos\.ai/.test(transfer), "NX-10: الخصوصية وتقييم النقل يسمّيان nexos.ai وAzure وترتيب تحليل الصور");
  }
}

{
  const { visionTextIsThin } = await import("../../functions/_lib/domain/visionFacts.js");
  const thin = JSON.stringify({ color: "أخضر فاتح", length: "ميدي", fit: "بقصّة A", sleeves: "قصيرة", details: [] });
  const rich = JSON.stringify({ color: "أخضر فاتح", length: "ميدي", fit: "بقصّة A", waist: "برباط", neckline: "مربعة", sleeves: "منفوخة", details: ["كشكش", "أزرار"] });
  assert(visionTextIsThin(thin, "فستان") && !visionTextIsThin(rich, "فستان") && visionTextIsThin("", "فستان"), "NX-11: قراءة ناقصة (بلا تفاصيل أو أقل من ٥ حقائق) تُكتشف، والغنية لا");
  const copySrc = readFileSync(new URL("../../functions/_lib/domain/copy.js", import.meta.url), "utf8");
  assert(/visionTextIsThin\(out\.text, name\)/.test(copySrc) && /nexosOnly: true/.test(copySrc), "NX-12: الوصف يصعّد قراءة الصورة الناقصة لـLuna مرة واحدة");
  assert(copySrc.includes("factsCtx.structured ? await askVisionDetailed({ env, imageUrl, prompt, nexosOnly: true })") && copySrc.includes("if (!out.text) out = await askVisionDetailed({ env, imageUrl, prompt });"), "NX-13: صور الأزياء (قراءة منظّمة) بـLuna أولاً والمجاني احتياط");
}

main().then(done);

// رسالة نفاد السعة اليومية — 2026-09-12 05:35 UTC: «جرّب بعد دقيقة» والحصص الثلاث يومية.
import { createRunner } from "../_helpers.mjs";
import { classifyError, messageFor } from "../../functions/_lib/core/errors.js";
import { askWorkersAI } from "../../functions/_lib/ai/gateway.js";

const { assert, done } = createRunner("ai-quota-message");

const CF = "workers-ai: 4006: you have used up your daily free allocation of 10,000 neurons";
const GROQ_TPD = "groq: Groq 429: Rate limit reached for model qwen/qwen3.8-27b on tokens per day (TPD): Limit 200000, Used 194482";
const GROQ_ITPM = "groq: Groq 429: Rate limit reached for model qwen/qwen3.8-27b on input tokens per minute (ITPM): Limit 7000";
const OR_DAY = "openrouter: OpenRouter nvidia/nemotron-3-super-120b-a12b:free 429: Rate limit exceeded: free-models-per-day";

async function main() {
  assert(classifyError(new Error([CF, GROQ_TPD, OR_DAY].join(" | "))) === "AI_QUOTA_DAILY", "QM-1: كل المزوّدين بحد يومي ⇒ AI_QUOTA_DAILY");
  assert(classifyError(new Error([CF, GROQ_ITPM, OR_DAY].join(" | "))) === "AI_BUSY", "QM-2: مزوّد محدود بالدقيقة فقط (Groq ITPM) ⇒ AI_BUSY، إعادة المحاولة قد تنجح");
  assert(classifyError(new Error("Groq 429: rate limit exceeded")) === "AI_BUSY", "QM-3: 429 بلا حد يومي يبقى AI_BUSY");
  assert(/اليوم/.test(messageFor("AI_QUOTA_DAILY")) && !/دقيقة/.test(messageFor("AI_QUOTA_DAILY")), "QM-4: رسالة الحصة اليومية لا تطلب دقيقة");
  {
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => (String(url).includes("groq")
      ? new Response("Rate limit reached on tokens per day (TPD)", { status: 429 })
      : new Response('{"error":{"message":"Rate limit exceeded: free-models-per-day"}}', { status: 429 }));
    let thrown = null;
    try {
      await askWorkersAI({ env: { AI: { run: async () => { throw new Error("4006: you have used up your daily free allocation of 10,000 neurons"); } }, GROQ_API_KEY: "g", OPENROUTER_API_KEY: "o" }, system: "s", messages: [{ role: "user", content: "u" }], skipCache: true });
    } catch (e) { thrown = e; } finally { globalThis.fetch = real; }
    const msg = String(thrown?.message || "");
    assert(/workers-ai: 4006/.test(msg) && /groq: /.test(msg) && /openrouter: /.test(msg) && classifyError(thrown) === "AI_QUOTA_DAILY", `QM-5: خطأ البوابة النهائي يحمل أسباب كل المزوّدين فيُصنَّف يومياً («${msg.slice(0, 120)}»)`);
  }
}

main().then(done);

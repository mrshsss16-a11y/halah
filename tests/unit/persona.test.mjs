import { createRunner } from "../_helpers.mjs";

const { assert, done } = createRunner("persona");

async function main() {
  // ── شخصية الوكيل من البيانات (migrations/0021_agent_profiles.sql) ──────────
  // الأهم هنا: سياسة الأسعار. أورا ممنوعة من ذكر رقم، والتاجر مسموح له —
  // نفس الكود بقرارين. لو انقلب هذا الشرط، أورا تخترع أسعاراً للعملاء.
  {
    const { buildAgentPrompt } = await import("../../functions/_lib/ai/persona.js");

    const auraPrompt = buildAgentPrompt({
      agent_name: "هالة",
      business_name: "أورا للتسويق",
      allow_prices: 0,
      emoji_level: 0
    });
    assert(
      /ممنوع منعاً باتاً ذكر أي رقم سعر/.test(auraPrompt),
      "AGENT-1: allow_prices=0 يفرض منع ذكر الأسعار بالبرومبت"
    );
    assert(
      /ممنوع استخدام أي إيموجي/.test(auraPrompt),
      "AGENT-2: emoji_level=0 يفرض منع الإيموجي"
    );

    const merchantPrompt = buildAgentPrompt({
      agent_name: "نورة",
      business_name: "متجر عطور",
      allow_prices: 1
    });
    assert(
      !/ممنوع منعاً باتاً ذكر أي رقم سعر/.test(merchantPrompt) && /نورة/.test(merchantPrompt),
      "AGENT-3: تاجر بـallow_prices=1 يذكر أسعاره، وباسم وكيله هو"
    );
    assert(
      !/أورا للتسويق/.test(merchantPrompt),
      "AGENT-4: عزل الشخصية — برومبت التاجر لا يحمل أي أثر لهوية تاجر آخر"
    );

    // JSON تالف بالحقول القابلة للتوسّع ما يصح يسقط بناء البرومبت كاملاً
    const brokenJson = buildAgentPrompt({ agent_name: "س", knowledge_links: "{not json" });
    assert(
      typeof brokenJson === "string" && brokenJson.length > 0,
      "AGENT-5: JSON تالف بـknowledge_links يُتجاهل بدل ما يكسر الرد"
    );

    const { saveAgentProfile } = await import("../../functions/_lib/domain/persona.js");
    const agentLog = [];
    const agentDb = {
      DB: {
        prepare(sql) {
          return {
            bind(...args) {
              agentLog.push({ sql, args });
              return { run: async () => ({}) };
            }
          };
        }
      }
    };
    await saveAgentProfile(agentDb, "m_x", { agent_name: "ن", status: "paused", merchant_id: "m_other" });
    assert(
      agentLog.length === 1 &&
        !/status/.test(agentLog[0].sql) &&
        agentLog[0].args[0] === "m_x" &&
        !agentLog[0].args.includes("m_other"),
      "AGENT-6: القائمة البيضاء ترفض status و merchant_id المرسلين من العميل"
    );
  }
}

main()
  .then(() => done())
  .catch((e) => {
    console.error("❌ Tests threw an exception:");
    console.error(e);
    process.exit(1);
  });

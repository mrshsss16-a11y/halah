import { createRunner } from "../_helpers.mjs";

const { assert, done } = createRunner("db-isolation");

async function main() {
  // 10. Tenant isolation (2026-09-05 audit — two real leaks found in production)
  //
  // These reproduce the exact failures, so reintroducing either breaks the build:
  //   - askWorkersAI cached under a shared "global" bucket keyed on only the
  //     first 20 chars of the system prompt, so merchant B's customer received
  //     merchant A's answer verbatim on any repeated question.
  //   - getOmnichannelSession looked a customer up by phone alone, so merchant
  //     B's bot loaded merchant A's browsing context for a shared shopper.
  const { askWorkersAI } = await import("../../functions/_lib/ai/gateway.js");

  function fakeKv() {
    const store = new Map();
    return {
      store,
      get: async (k) => (store.has(k) ? store.get(k) : null),
      put: async (k, v) => { store.set(k, v); },
      delete: async (k) => { store.delete(k); }
    };
  }
  // Both merchants share the same persona preamble and differ only further down
  // the prompt — exactly the shape that defeated the old 20-char fingerprint.
  const PREAMBLE = "أنتِ مساعدة متجر سعودية ودودة، تردين بإيجاز وبلهجة بيضاء.";
  const systemFor = (store) => `${PREAMBLE}\nتعليمات المتجر: ${store}`;
  const question = [{ role: "user", content: "وش سياسة الإرجاع عندكم؟" }];

  const kv = fakeKv();
  const aiEnv = (answer) => ({
    HALA_CACHE: kv,
    AI: { run: async () => ({ response: answer }) }
  });

  const replyA = await askWorkersAI({
    env: aiEnv("الإرجاع خلال ١٤ يوم — متجر أ"),
    system: systemFor("متجر أ: إرجاع خلال ١٤ يوم"),
    messages: question,
    storeId: "m_aaa"
  });
  const replyB = await askWorkersAI({
    env: aiEnv("الإرجاع خلال ٣ أيام — متجر ب"),
    system: systemFor("متجر ب: إرجاع خلال ٣ أيام"),
    messages: question,
    storeId: "m_bbb"
  });
  assert(replyA.includes("متجر أ"), "askWorkersAI returned merchant A's own answer");
  assert(
    replyB.includes("متجر ب") && !replyB.includes("متجر أ"),
    "tenant isolation: merchant B never receives merchant A's cached answer"
  );

  // Same merchant, same question → cache SHOULD hit (isolation must not cost caching)
  const replyA2 = await askWorkersAI({
    env: aiEnv("رد مختلف تماماً لو ما ضرب الكاش"),
    system: systemFor("متجر أ: إرجاع خلال ١٤ يوم"),
    messages: question,
    storeId: "m_aaa"
  });
  assert(replyA2 === replyA, "cache still hits for the same merchant + same question");

  // No storeId → must run uncached rather than pooling merchants together
  const kvBefore = kv.store.size;
  await askWorkersAI({
    env: { HALA_CACHE: kv, AI: { run: async () => ({ response: "رد بلا نطاق متجر" }) } },
    system: systemFor("متجر مجهول"),
    messages: question
  });
  assert(kv.store.size === kvBefore, "a call without storeId writes nothing to the shared cache");

  // Omnichannel session must be scoped by merchant, not by phone alone
  const { getOmnichannelSession } = await import("../../functions/_lib/domain/conversation.js");
  const sessionRow = { merchant_id: "m_aaa", phone: "966500000001", last_product: "عباية متجر أ" };
  const dbEnv = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => {
                // Emulate D1: the row only comes back if the SQL actually filters
                // on merchant_id AND the bound merchant matches.
                if (!/merchant_id/.test(sql)) return sessionRow;
                return args[1] === sessionRow.merchant_id ? sessionRow : null;
              }
            };
          }
        };
      }
    }
  };
  const ownSession = await getOmnichannelSession(dbEnv, { phone: "966500000001", merchantId: "m_aaa" });
  const otherSession = await getOmnichannelSession(dbEnv, { phone: "966500000001", merchantId: "m_bbb" });
  const unscopedSession = await getOmnichannelSession(dbEnv, { phone: "966500000001" });
  assert(ownSession && ownSession.last_product === "عباية متجر أ", "merchant A loads its own customer session");
  assert(otherSession === null, "tenant isolation: merchant B cannot load merchant A's customer session");
  assert(unscopedSession === null, "phone lookup without merchantId fails closed");
}

main()
  .then(() => done())
  .catch((e) => {
    console.error("❌ Tests threw an exception:");
    console.error(e);
    process.exit(1);
  });

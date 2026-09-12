// تدقيق الأمن 2026-09-13 (البند ١، عالي): /api/store/status كانت ترجع المعرّف الداخلي لمتجر سلة غير
// مسجَّل لأي مجهول يرسل رقم المتجر، والمعرّف هو اعتماد تلك المتاجر الوحيد بـresolveStoreId.
import { readFileSync } from "node:fs";
import { createRunner } from "../_helpers.mjs";

const { assert, done } = createRunner("store-status-isolation");

async function main() {
  const src = readFileSync(new URL("../../functions/api/store/status.js", import.meta.url), "utf8");
  const code = src.replace(/^\s*\/\/.*$/gm, "");
  assert(!/body\.(?:storeId|sallaMerchantId)/.test(code) && !/getMerchantBySalla/.test(code), "SSI-1: لا بحث عن متجر بمعرّف أو رقم سلة من جسم الطلب");
  assert(/const merchant = sessionMerchantId \? await getMerchant\(env, sessionMerchantId\) : null;/.test(code) && /if \(!merchant\) return \{ linked: false \};/.test(code), "SSI-2: المتجر من الجلسة وحدها، والمجهول يُرد بـ{linked:false} فقط");

  const { onRequestPost } = await import("../../functions/api/store/status.js");
  const calls = [];
  const env = {
    DB: {
      prepare: (sql) => ({
        bind: (...b) => ({
          first: async () => { calls.push(sql); return { id: "m_victim", store_name: "متجر الضحية", salla_merchant_id: "1354270932" }; },
          all: async () => { calls.push(sql); return { results: [] }; },
          run: async () => ({})
        })
      })
    }
  };
  for (const body of [{ sallaMerchantId: "1354270932" }, { storeId: "m_victim" }, {}]) {
    const req = new Request("https://hala-ai-os.pages.dev/api/store/status", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://hala-ai-os.pages.dev" }, body: JSON.stringify(body) });
    const res = await onRequestPost({ request: req, env, waitUntil: () => {} });
    const text = await res.text();
    assert(!/m_victim|متجر الضحية/.test(text), `SSI-3: طلب مجهول ${JSON.stringify(body)} لا يكشف معرّف متجر ولا اسمه («${text.slice(0, 120)}»)`);
  }
}

main().then(done);

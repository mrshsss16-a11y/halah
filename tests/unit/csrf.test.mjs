import { createRunner } from "../_helpers.mjs";

const { assert, done } = createRunner("csrf");

async function main() {
  // ── ودجت موقع أورا لا يُحجب بـCSRF (رُصد بسجل الأخطاء 2026-09-08) ──
  {
    const { assertTrustedWrite } = await import("../../functions/_lib/core/csrf.js");
    const mk = (origin) => new Request("https://hala-ai-os.pages.dev/api/support", {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}"
    });
    let blocked = [];
    for (const o of ["https://aura.sa", "https://www.aura.sa"]) {
      try { assertTrustedWrite(mk(o), {}); } catch (e) { blocked.push(o); }
    }
    assert(blocked.length === 0, `CSRF-AURA-1: أصول موقع أورا تمر ببوابة CSRF (المحجوب: ${blocked.join(",") || "لا شيء"})`);
    let evilBlocked = false;
    try { assertTrustedWrite(mk("https://evil.example"), {}); } catch (e) { evilBlocked = true; }
    assert(evilBlocked, "CSRF-AURA-2: أصل غريب ما زال محجوباً");
  }
}

main()
  .then(() => done())
  .catch((e) => {
    console.error("❌ Tests threw an exception:");
    console.error(e);
    process.exit(1);
  });

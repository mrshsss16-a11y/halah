import { createRunner } from "../_helpers.mjs";
import { createSessionVersionKv, createRlKv, TEST_SESSION_SECRET } from "../_helpers.mjs";
import { createSessionToken, verifySessionToken } from "../../functions/_lib/core/session.js";

const { assert, done } = createRunner("session");

async function main() {
  const env = { SESSION_SECRET: TEST_SESSION_SECRET, HALA_CACHE: createSessionVersionKv() };
  const rlKv = createRlKv();
  // 4. createSessionToken & verifySessionToken
  const merchantId = "m_test_123";
  // The subtle crypto requires global crypto in node
  if (!globalThis.crypto) {
    const crypto = await import("crypto");
    globalThis.crypto = crypto.webcrypto;
  }
  
  const token = await createSessionToken(env, merchantId);
  assert(token.split(".").length === 4, "createSessionToken created valid format token (merchant.expiry.version.mac — P40)");
  const verifiedId = await verifySessionToken(env, token);
  assert(verifiedId === merchantId, "verifySessionToken successfully verified the token");

  // 6. Pillar 1 — product copy (SEO + Saudi market)
  const copyMod = await import("../../functions/api/copy.js");
  assert(typeof copyMod.onRequestPost === "function", "copy.js exports valid onRequestPost middleware");

  // 6b. REGRESSION GUARD (M6, PROBLEMS.md P29 — verified live 2026-09-07):
  // /api/copy used to fall through resolveStoreId() to the anonymous
  // "default-store" bucket, so anyone on the internet with no cookie got a
  // full product description + SEO/JSON-LD bundle on our AI bill. These
  // handlers must now reject with 401 LOGIN_REQUIRED BEFORE any model call.
  // If any of these turn green-with-200 again, the hole is back.
  const anonEnv = { SESSION_SECRET: "test-secret-12345" }; // no DB, no KV, no cookie
  const anonReq = (url) =>
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "عطر عود ملكي", productName: "عطر عود ملكي", category: "عطور", price: "350" })
    });

  for (const [label, mod, url] of [
    ["/api/copy", copyMod, "https://x.test/api/copy"],
    ["/api/chat", await import("../../functions/api/chat.js"), "https://x.test/api/chat"],
    ["/api/image", await import("../../functions/api/image.js"), "https://x.test/api/image"],
    ["/api/store/bulk/upload", await import("../../functions/api/store/bulk/upload.js"), "https://x.test/api/store/bulk/upload"]
  ]) {
    const req = anonReq(url);
    const res = await mod.onRequestPost({ request: req, env: anonEnv });
    const payload = await res.json().catch(() => ({}));
    assert(
      res.status === 401 && payload.code === "LOGIN_REQUIRED",
      `${label} rejects an anonymous (no-session) caller with 401 LOGIN_REQUIRED (got ${res.status} ${payload.code})`
    );
  }

  // 6c. Option ب gate (2026-09-07): a Salla merchant with a VALID session but
  // no row in `accounts` must be able to browse, but blocked at the first real
  // operation with 403 ACCOUNT_REQUIRED — distinct from 401 LOGIN_REQUIRED.
  const SALLA_MID = "m_salla_noacct";
  const PAID_MID = "m_full_account";

  // DB where both merchants exist, but only PAID_MID has an accounts row.
  const gateDb = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => {
              if (/FROM merchants WHERE id/.test(sql)) {
                return [SALLA_MID, PAID_MID].includes(args[0]) ? { id: args[0] } : null;
              }
              if (/FROM accounts WHERE merchant_id/.test(sql)) {
                return args[0] === PAID_MID ? { email: "merchant@example.com" } : null;
              }
              return null;
            },
            run: async () => ({ meta: { last_row_id: 1 } })
          };
        }
      };
    }
  };
  const gateEnv = { SESSION_SECRET: "test-secret-12345", HALA_CACHE: rlKv, DB: gateDb };
  const sessionReq = async (url, mid, bodyObj) => {
    const tok = await createSessionToken(gateEnv, mid);
    return new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `hala_session=${encodeURIComponent(tok)}` },
      body: JSON.stringify(bodyObj || {})
    });
  };

  const { requireCompletedAccount } = await import("../../functions/_lib/core/session.js");

  // The gate itself: three outcomes.
  let gateCode = null;
  try {
    await requireCompletedAccount(await sessionReq("https://x.test/api/copy", SALLA_MID), gateEnv, undefined);
  } catch (e) {
    gateCode = e?.code;
  }
  assert(gateCode === "ACCOUNT_REQUIRED", `session-without-account → ACCOUNT_REQUIRED (got ${gateCode})`);

  const gatePass = await requireCompletedAccount(
    await sessionReq("https://x.test/api/copy", PAID_MID),
    gateEnv,
    undefined
  );
  assert(gatePass === PAID_MID, "completed account passes requireCompletedAccount");

  let anonGateCode = null;
  try {
    await requireCompletedAccount(anonReq("https://x.test/api/copy"), anonEnv, undefined);
  } catch (e) {
    anonGateCode = e?.code;
  }
  assert(anonGateCode === "LOGIN_REQUIRED", `fully anonymous still → LOGIN_REQUIRED (P36 intact, got ${anonGateCode})`);

  // The six real-operation endpoints, end to end.
  const realOps = [
    ["/api/copy", copyMod],
    ["/api/chat", await import("../../functions/api/chat.js")],
    ["/api/image", await import("../../functions/api/image.js")],
    ["/api/store/bulk/upload", await import("../../functions/api/store/bulk/upload.js")],
    ["/api/store/publish", await import("../../functions/api/store/publish.js")],
    ["/api/whatsapp/connect", await import("../../functions/api/whatsapp/connect.js")]
  ];
  for (const [label, mod] of realOps) {
    const res = await mod.onRequestPost({
      request: await sessionReq(`https://x.test${label}`, SALLA_MID, {
        name: "عطر", productName: "عطر", productId: "1", description: "وصف", code: "x"
      }),
      env: gateEnv
    });
    const payload = await res.json().catch(() => ({}));
    assert(
      res.status === 403 && payload.code === "ACCOUNT_REQUIRED",
      `${label} blocks a session-without-account with 403 ACCOUNT_REQUIRED (got ${res.status} ${payload.code})`
    );
  }

  // Read-only endpoints must stay open for that same account-less merchant.
  for (const [label, mod] of [
    ["/api/usage", await import("../../functions/api/usage.js")],
    ["/api/store/bulk/status", await import("../../functions/api/store/bulk/status.js")]
  ]) {
    const res = await mod.onRequestPost({
      request: await sessionReq(`https://x.test${label}`, SALLA_MID, {}),
      env: gateEnv
    });
    const payload = await res.json().catch(() => ({}));
    assert(
      payload.code !== "ACCOUNT_REQUIRED" && payload.code !== "LOGIN_REQUIRED",
      `${label} stays readable for an account-less Salla merchant (got ${res.status} ${payload.code || "ok"})`
    );
  }

  // /api/auth/complete_account: merchantId from the session only.
  const completeMod = await import("../../functions/api/auth/complete_account.js");
  const anonComplete = await completeMod.onRequestPost({
    request: new Request("https://x.test/api/auth/complete_account", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.com", password: "12345678", merchantId: PAID_MID })
    }),
    env: gateEnv
  });
  assert(
    anonComplete.status === 401,
    `complete_account rejects a session-less caller even when it claims a merchantId (got ${anonComplete.status})`
  );

  const dupeComplete = await completeMod.onRequestPost({
    request: await sessionReq("https://x.test/api/auth/complete_account", PAID_MID, {
      email: "new@example.com", password: "12345678"
    }),
    env: gateEnv
  });
  const dupePayload = await dupeComplete.json().catch(() => ({}));
  assert(
    dupeComplete.status === 409 && dupePayload.code === "ACCOUNT_EXISTS",
    `complete_account refuses a merchant that already has an account (got ${dupeComplete.status} ${dupePayload.code})`
  );

  // The public visitor widget must stay anonymous — it is the deliberate
  // exception (fixed storeId "hala", rate limited). Guard against an
  // over-broad future lockdown breaking Aura's own site chat.
  const sessionMod = await import("../../functions/_lib/core/session.js");
  const anonWidgetStore = await sessionMod.resolveStoreId(anonReq("https://x.test/api/support"), anonEnv, undefined);
  assert(anonWidgetStore === "default-store", "resolveStoreId still returns default-store for anonymous widget traffic");

}

main()
  .then(() => done())
  .catch((e) => {
    console.error("❌ Tests threw an exception:");
    console.error(e);
    process.exit(1);
  });

import { createRunner } from "../_helpers.mjs";

const { assert, done } = createRunner("whatsapp");

async function main() {
  // 12. WhatsApp webhook signature (behavioural — not an export check)
  const { verifyWaSignature } = await import("../../functions/_lib/integrations/whatsapp.js");
  const waSecret = "app-secret-abc";
  const waBody = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "1" }] });

  async function sign(body, secret) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  const goodSig = await sign(waBody, waSecret);
  assert(
    await verifyWaSignature(waBody, `sha256=${goodSig}`, waSecret),
    "verifyWaSignature accepts a correctly signed payload"
  );
  assert(
    await verifyWaSignature(waBody, goodSig, waSecret),
    "verifyWaSignature accepts the digest without the sha256= prefix"
  );
  // Same signature, tampered body → must reject
  assert(
    !(await verifyWaSignature(waBody + " ", `sha256=${goodSig}`, waSecret)),
    "verifyWaSignature rejects a tampered body under a valid old signature"
  );
  // Right shape, wrong secret → must reject
  const wrongSecretSig = await sign(waBody, "attacker-secret");
  assert(
    !(await verifyWaSignature(waBody, `sha256=${wrongSecretSig}`, waSecret)),
    "verifyWaSignature rejects a signature made with the wrong app secret"
  );
  // One flipped hex char → must reject (guards the constant-time compare)
  const flipped = (goodSig[0] === "a" ? "b" : "a") + goodSig.slice(1);
  assert(
    !(await verifyWaSignature(waBody, `sha256=${flipped}`, waSecret)),
    "verifyWaSignature rejects a one-character-off signature"
  );
  // Fail closed: missing secret must never authenticate anything
  assert(
    !(await verifyWaSignature(waBody, `sha256=${goodSig}`, undefined)) &&
      !(await verifyWaSignature(waBody, `sha256=${goodSig}`, "")) &&
      !(await verifyWaSignature(waBody, "sha256=", "")),
    "verifyWaSignature fails closed when the app secret is missing"
  );
  assert(
    !(await verifyWaSignature(waBody, null, waSecret)) &&
      !(await verifyWaSignature(waBody, "", waSecret)),
    "verifyWaSignature rejects a request with no signature header"
  );


  // WhatsApp Embedded Signup — Coexistence history sync (SMB App Data API).
  // Not live yet (waiting on Meta Tech Provider approval), but the logic is
  // built now — cover it so a future refactor can't silently break it.
  const { requestCoexistenceSync, syncCoexistenceHistory } = await import("../../functions/_lib/integrations/whatsapp.js");
  const realFetch = global.fetch;
  try {
    const calls = [];
    global.fetch = async (url, opts) => {
      calls.push({ url: String(url), opts });
      return { ok: true, json: async () => ({ success: true }) };
    };
    await syncCoexistenceHistory("waba_123", "tok_abc");
    assert(calls.length === 2, "syncCoexistenceHistory makes exactly two SMB App Data calls (contacts, then history)");
    assert(calls[0].url.includes("waba_123/smb_app_data"), "coexistence sync calls smb_app_data on the merchant's own WABA");
    assert(JSON.parse(calls[0].opts.body).sync_type === "smb_app_state_sync", "first call syncs contacts (smb_app_state_sync) before history");
    assert(JSON.parse(calls[1].opts.body).sync_type === "history", "second call syncs message history");
    assert(calls[0].opts.headers.Authorization === "Bearer tok_abc", "coexistence sync authenticates with the merchant's own business token, not a shared one");

    global.fetch = async () => ({ ok: false, status: 400, text: async () => "bad request" });
    let threw = false;
    try {
      await requestCoexistenceSync("waba_123", "tok_abc", "history");
    } catch {
      threw = true;
    }
    assert(threw, "requestCoexistenceSync throws on a failed Graph API call instead of silently succeeding");
  } finally {
    global.fetch = realFetch;
  }
}

main()
  .then(() => done())
  .catch((e) => {
    console.error("❌ Tests threw an exception:");
    console.error(e);
    process.exit(1);
  });

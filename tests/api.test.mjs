import { matchFastIntent } from "../functions/_lib/ai/intents.js";
import { hashPassword, verifyPassword } from "../functions/_lib/core/auth.js";
import { saveConsultationBooking } from "../functions/_lib/core/db.js";
import { createSessionToken, verifySessionToken } from "../functions/_lib/core/session.js";

const env = {
  SESSION_SECRET: "test-secret-12345"
};

async function runTests() {
  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${message}`);
    }
  }

  console.log("Starting Tests...\n");

  // 1. matchFastIntent
  const start = performance.now();
  const intent = matchFastIntent("اريد تتبع الشحنة", "saudi_najdi");
  const duration = performance.now() - start;
  assert(intent !== null, `matchFastIntent returned result`);
  assert(duration < 5, `matchFastIntent fast enough (took ${duration.toFixed(2)}ms)`);

  // 2. hashPassword & verifyPassword
  const pw = "securePassword123";
  const { hash, salt } = await hashPassword(pw);
  assert(hash && salt, "hashPassword generated hash and salt");
  const isValid = await verifyPassword(pw, hash, salt);
  assert(isValid, "verifyPassword verified correct password successfully");
  const isInvalid = await verifyPassword("wrong", hash, salt);
  assert(!isInvalid, "verifyPassword rejected incorrect password correctly");

  // 3. saveConsultationBooking and AURA-XXXXX
  let updatedTicketCode = null;
  const mockEnvDb = {
    DB: {
      prepare: (query) => {
        return {
          bind: (...args) => {
            return {
              run: async () => {
                if (query.includes("UPDATE consultation_bookings")) {
                  updatedTicketCode = args[0];
                }
                return { meta: { last_row_id: 1234 } };
              }
            }
          }
        }
      }
    }
  };
  const booking = await saveConsultationBooking(mockEnvDb, { name: "Test", phone: "123", slotLabel: "Slot 1" });
  assert(booking.id === 1234, "saveConsultationBooking returned correct ID");
  assert(updatedTicketCode === "AURA-01234", `Ticket code formatted as AURA-XXXXX: ${updatedTicketCode}`);

  // 4. createSessionToken & verifySessionToken
  const merchantId = "m_test_123";
  // The subtle crypto requires global crypto in node
  if (!globalThis.crypto) {
    const crypto = await import("crypto");
    globalThis.crypto = crypto.webcrypto;
  }
  
  const token = await createSessionToken(env, merchantId);
  assert(token.split(".").length === 3, "createSessionToken created valid format token");
  const verifiedId = await verifySessionToken(env, token);
  assert(verifiedId === merchantId, "verifySessionToken successfully verified the token");

  // 5. Security Module (Sanitizer, Security Headers, Turnstile)
  const { sanitizeInput, getSecurityHeaders, verifyTurnstileToken } = await import("../functions/_lib/core/security.js");
  const dirtyInput = "<script>alert('xss')</script>hello <b onload='evil()'>world</b>";
  const cleanInput = sanitizeInput(dirtyInput);
  assert(!cleanInput.includes("<script>") && !cleanInput.includes("onload="), `sanitizeInput stripped scripts and HTML tags: "${cleanInput}"`);

  const headers = getSecurityHeaders();
  assert(headers["X-Frame-Options"] === "DENY", "getSecurityHeaders returns X-Frame-Options DENY");
  assert(headers["X-Content-Type-Options"] === "nosniff", "getSecurityHeaders returns X-Content-Type-Options nosniff");

  const turnstileDev = await verifyTurnstileToken({}, "dummy_token");
  assert(turnstileDev.success && turnstileDev.bypass, "verifyTurnstileToken passes gracefully when secret key is unset");

  // 6. Pillar 1 — product copy (SEO + Saudi market)
  const copyMod = await import("../functions/api/copy.js");
  assert(typeof copyMod.onRequestPost === "function", "copy.js exports valid onRequestPost middleware");

  // 7. Pillar 2 — customer-service agents (store chat + WhatsApp)
  const chatMod = await import("../functions/api/chat.js");
  assert(typeof chatMod.onRequestPost === "function", "chat.js exports valid onRequestPost middleware");

  const waWebhookMod = await import("../functions/api/whatsapp/webhook.js");
  assert(typeof waWebhookMod.onRequestPost === "function", "whatsapp/webhook.js exports valid onRequestPost middleware");
  assert(typeof waWebhookMod.onRequestGet === "function", "whatsapp/webhook.js exports the Meta verification handshake");

  const personaMod = await import("../functions/api/store/persona.js");
  assert(typeof personaMod.onRequestPost === "function", "persona.js exports valid onRequestPost middleware");

  const contextMod = await import("../functions/api/store/context.js");
  assert(typeof contextMod.onRequestPost === "function", "store/context.js exports valid onRequestPost middleware");

  // 8. Salla — the only storefront integration in scope
  const publishMod = await import("../functions/api/store/publish.js");
  assert(typeof publishMod.onRequestPost === "function", "store/publish.js exports valid onRequestPost middleware");

  const sallaWebhookMod = await import("../functions/api/webhooks/salla.js");
  assert(typeof sallaWebhookMod.onRequestPost === "function", "webhooks/salla.js exports valid onRequestPost middleware");

  // 9. Pillar 3 — accounts portal
  const forgotMod = await import("../functions/api/auth/forgot_password.js");
  assert(typeof forgotMod.onRequestPost === "function", "forgot_password.js exports valid onRequestPost middleware");

  const signupMod = await import("../functions/api/auth/signup.js");
  assert(typeof signupMod.onRequestPost === "function", "signup.js exports valid onRequestPost middleware");

  const loginMod = await import("../functions/api/auth/login.js");
  assert(typeof loginMod.onRequestPost === "function", "login.js exports valid onRequestPost middleware");

  const resetMod = await import("../functions/api/auth/reset_password.js");
  assert(typeof resetMod.onRequestPost === "function", "reset_password.js exports valid onRequestPost middleware");

  const googleMod = await import("../functions/api/auth/google.js");
  assert(typeof googleMod.onRequestPost === "function", "google.js exports valid onRequestPost middleware");

  // 10. Tenant isolation (2026-09-05 audit — two real leaks found in production)
  //
  // These reproduce the exact failures, so reintroducing either breaks the build:
  //   - askWorkersAI cached under a shared "global" bucket keyed on only the
  //     first 20 chars of the system prompt, so merchant B's customer received
  //     merchant A's answer verbatim on any repeated question.
  //   - getOmnichannelSession looked a customer up by phone alone, so merchant
  //     B's bot loaded merchant A's browsing context for a shared shopper.
  const { askWorkersAI } = await import("../functions/_lib/ai/gateway.js");

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
  const { getOmnichannelSession } = await import("../functions/_lib/core/db.js");
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

  // 11. Batch-1 security fixes (SECURITY_AUDIT 2026-09-05)
  const { resolveStoreId } = await import("../functions/_lib/core/session.js");

  // A merchants DB where only "m_real" exists (an account-less Salla install).
  const storeEnv = {
    SESSION_SECRET: "test-secret-12345",
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => {
                // getMerchant: SELECT * FROM merchants WHERE id = ?
                if (/FROM merchants WHERE id/.test(sql)) {
                  return args[0] === "m_real" ? { id: "m_real", store_name: "متجر" } : null;
                }
                // getAccountEmail / accounts lookups → no account for these
                return null;
              }
            };
          }
        };
      }
    }
  };
  const noCookieReq = { headers: { get: () => null } };

  // C2: an invented storeId with no merchant row must NOT become its own tenant
  const invented = await resolveStoreId(noCookieReq, storeEnv, "x_invented_9999");
  assert(invented === "default-store", "C2: unknown claimed storeId falls back to default-store (no free quota farming)");

  // C2: a real account-less Salla merchant is still addressable by id
  const real = await resolveStoreId(noCookieReq, storeEnv, "m_real");
  assert(real === "m_real", "account-less Salla merchant still reachable by id");

  // C2/H7: the reserved unmetered "hala" id can never be claimed anonymously
  let halaBlocked = false;
  try {
    await resolveStoreId(noCookieReq, storeEnv, "hala");
  } catch (e) {
    halaBlocked = e?.code === "LOGIN_REQUIRED";
  }
  assert(halaBlocked, "C2/H7: anonymous caller cannot claim the unmetered 'hala' tenant");

  // C3: the admin escape helper neutralizes an XSS payload
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const escaped = esc('<img src=x onerror=alert(1)>');
  assert(!escaped.includes("<img") && escaped.includes("&lt;img"), "C3: escapeHtml neutralizes an XSS payload");

  // C3 defence-in-depth: sanitizeInput strips tags from a store name
  const { sanitizeInput: sanitize } = await import("../functions/_lib/core/security.js");
  assert(!sanitize('<script>x</script>متجر', 100).includes("<"), "C3: sanitizeInput strips tags from storeName");

  // 12. WhatsApp webhook signature (behavioural — not an export check)
  const { verifyWaSignature } = await import("../functions/_lib/integrations/whatsapp.js");
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

  // 13. Monthly quota — exhaustion + per-merchant isolation
  const { checkAndConsumeMonthly, MONTHLY_BUCKET_LIMITS } = await import("../functions/_lib/core/meter.js");

  // D1 stand-in that honours the conditional upsert's WHERE used + cost <= limit,
  // so the cold path is tested against real bookkeeping, not a stub that says yes.
  function fakeQuotaDb() {
    const rows = new Map(); // "merchant|period|bucket" → used
    return {
      rows,
      prepare(sql) {
        return {
          bind(...args) {
            return {
              run: async () => {
                const [merchantId, period, bucket, cost, , , limit] = args;
                const k = `${merchantId}|${period}|${bucket}`;
                const used = rows.get(k) || 0;
                if (used + cost > limit) return { meta: { changes: 0 } };
                rows.set(k, used + cost);
                return { meta: { changes: 1 } };
              },
              first: async () => {
                const [merchantId, period, bucket] = args;
                if (!/merchant_id/.test(sql)) throw new Error("quota query is not merchant-scoped");
                const k = `${merchantId}|${period}|${bucket}`;
                return rows.has(k) ? { used: rows.get(k) } : null;
              }
            };
          }
        };
      }
    };
  }

  const imgLimit = MONTHLY_BUCKET_LIMITS.image;

  // ── Cold path (D1 only, no KV) ─────────────────────────────────────────
  const coldEnv = { DB: fakeQuotaDb() };
  let lastCold = null;
  for (let i = 0; i < imgLimit; i++) {
    lastCold = await checkAndConsumeMonthly(coldEnv, "m_aaa", "image");
    if (!lastCold.ok) break;
  }
  assert(lastCold.ok && lastCold.used === imgLimit, `D1 path: merchant A consumed its whole ${imgLimit}-image quota`);
  const coldOver = await checkAndConsumeMonthly(coldEnv, "m_aaa", "image");
  assert(!coldOver.ok, "D1 path: the request past the monthly limit is refused");
  assert(coldOver.remaining === 0, "D1 path: an exhausted quota reports 0 remaining");

  // Merchant B is untouched by merchant A having burned its entire quota
  const coldB = await checkAndConsumeMonthly(coldEnv, "m_bbb", "image");
  assert(
    coldB.ok && coldB.used === 1 && coldB.remaining === imgLimit - 1,
    "tenant isolation: merchant A exhausting its quota does not consume merchant B's"
  );
  // …and buckets don't bleed into each other for the same merchant
  const coldOtherBucket = await checkAndConsumeMonthly(coldEnv, "m_aaa", "message");
  assert(coldOtherBucket.ok && coldOtherBucket.used === 1, "an exhausted image bucket does not exhaust the message bucket");

  // ── Fast path (KV cache in front of D1) ────────────────────────────────
  const quotaKv = fakeKv();
  const hotEnv = { DB: fakeQuotaDb(), HALA_CACHE: quotaKv };
  let lastHot = null;
  for (let i = 0; i < imgLimit; i++) {
    lastHot = await checkAndConsumeMonthly(hotEnv, "m_aaa", "image");
    if (!lastHot.ok) break;
  }
  assert(lastHot.ok && lastHot.used === imgLimit, "KV path: merchant A consumed its whole image quota");
  assert(!(await checkAndConsumeMonthly(hotEnv, "m_aaa", "image")).ok, "KV path: the request past the monthly limit is refused");
  const hotB = await checkAndConsumeMonthly(hotEnv, "m_bbb", "image");
  assert(hotB.ok && hotB.used === 1, "KV path tenant isolation: merchant B's quota is keyed separately");
  // A cost larger than what is left must be refused whole, not partially charged
  const hotC = await checkAndConsumeMonthly(hotEnv, "m_ccc", "image", imgLimit + 1);
  assert(!hotC.ok && hotC.used === 0, "an over-budget single call is refused without consuming anything");

  // Unknown bucket must throw rather than silently granting an unmetered call
  let unknownBucketThrew = false;
  try {
    await checkAndConsumeMonthly(hotEnv, "m_aaa", "not_a_bucket");
  } catch {
    unknownBucketThrew = true;
  }
  assert(unknownBucketThrew, "checkAndConsumeMonthly throws on an unknown bucket instead of allowing the call");

  console.log(`\nTest Summary: ${passed}/${total} Passed.`);
  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error("❌ Tests threw an exception:");
  console.error(e);
  process.exit(1);
});

import { matchFastIntent } from "../functions/_lib/ai/intents.js";
import { hashPassword, verifyPassword } from "../functions/_lib/core/auth.js";
import { saveConsultationBooking } from "../functions/_lib/core/db.js";
import { createSessionToken, verifySessionToken } from "../functions/_lib/core/session.js";

// P40: session tokens carry accounts.session_version, verified KV-first. This
// mirror answers "0" for everyone so token tests never need a D1 mock — and so
// tests that assert "must not reach the DB" keep meaning exactly that.
const sessionVersionKv = { get: async () => "0", put: async () => {}, delete: async () => {} };
const env = {
  SESSION_SECRET: "test-secret-12345",
  HALA_CACHE: sessionVersionKv
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
  assert(token.split(".").length === 4, "createSessionToken created valid format token (merchant.expiry.version.mac — P40)");
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
    ["/api/chat", await import("../functions/api/chat.js"), "https://x.test/api/chat"],
    ["/api/image", await import("../functions/api/image.js"), "https://x.test/api/image"],
    ["/api/store/bulk/upload", await import("../functions/api/store/bulk/upload.js"), "https://x.test/api/store/bulk/upload"]
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
  const gateEnv = { SESSION_SECRET: "test-secret-12345", DB: gateDb };
  const sessionReq = async (url, mid, bodyObj) => {
    const tok = await createSessionToken(gateEnv, mid);
    return new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `hala_session=${encodeURIComponent(tok)}` },
      body: JSON.stringify(bodyObj || {})
    });
  };

  const { requireCompletedAccount } = await import("../functions/_lib/core/session.js");

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
    ["/api/chat", await import("../functions/api/chat.js")],
    ["/api/image", await import("../functions/api/image.js")],
    ["/api/store/bulk/upload", await import("../functions/api/store/bulk/upload.js")],
    ["/api/store/publish", await import("../functions/api/store/publish.js")],
    ["/api/whatsapp/connect", await import("../functions/api/whatsapp/connect.js")]
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
    ["/api/usage", await import("../functions/api/usage.js")],
    ["/api/store/bulk/status", await import("../functions/api/store/bulk/status.js")]
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
  const completeMod = await import("../functions/api/auth/complete_account.js");
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
  const sessionMod = await import("../functions/_lib/core/session.js");
  const anonWidgetStore = await sessionMod.resolveStoreId(anonReq("https://x.test/api/support"), anonEnv, undefined);
  assert(anonWidgetStore === "default-store", "resolveStoreId still returns default-store for anonymous widget traffic");

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

  // 9b. P38 — no self-service path may create an account with an ADMIN_EMAILS
  // address. requireAdmin() matches accounts.email against that secret and
  // there is no is_admin column, so such a row IS full admin. These are
  // behavioural: the endpoint must answer 409 and must NEVER reach the DB
  // INSERT (the mock throws on any DB use, so a regression fails loudly).
  const { isAdminEmail } = await import("../functions/_lib/core/adminEmails.js");
  const adminEnv = { ADMIN_EMAILS: " Admin@Aura.SA , second@aura.sa ", SESSION_SECRET: env.SESSION_SECRET, HALA_CACHE: sessionVersionKv };
  assert(isAdminEmail(adminEnv, "admin@aura.sa"), "isAdminEmail trims and lowercases both sides");
  assert(isAdminEmail(adminEnv, "  SECOND@aura.sa "), "isAdminEmail handles spaces around commas");
  assert(!isAdminEmail(adminEnv, "merchant@aura.sa"), "isAdminEmail rejects a non-admin address");
  assert(!isAdminEmail({ ADMIN_EMAILS: "" }, ""), "isAdminEmail never matches an empty address");

  const explodingDb = {
    prepare() {
      throw new Error("signup reached the database with an admin email");
    }
  };
  function jsonReq(body, headers = {}) {
    return new Request("https://x/api", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body)
    });
  }

  const signupRes = await signupMod.onRequestPost({
    request: jsonReq({ email: "  ADMIN@aura.sa ", password: "longenoughpw" }),
    env: { ...adminEnv, DB: explodingDb }
  });
  const signupBody = await signupRes.json();
  assert(signupRes.status === 409, `signup rejects an ADMIN_EMAILS address (got ${signupRes.status})`);
  assert(
    signupBody.error === "هذا البريد مسجّل مسبقاً — سجّل دخول بدل ذلك.",
    "signup admin rejection reuses the generic 'email taken' message (no admin enumeration)"
  );

  const adminRejectCompleteMod = await import("../functions/api/auth/complete_account.js");
  const completeToken = await createSessionToken(adminEnv, "m_test_admin_reject");
  const completeRes = await adminRejectCompleteMod.onRequestPost({
    request: jsonReq(
      { email: "second@AURA.sa", password: "longenoughpw" },
      { Cookie: `hala_session=${encodeURIComponent(completeToken)}` }
    ),
    env: { ...adminEnv, DB: explodingDb }
  });
  assert(completeRes.status === 409, `complete_account rejects an ADMIN_EMAILS address (got ${completeRes.status})`);

  // A non-admin address must still get past the guard and reach the DB — proves
  // the check is targeted, not a blanket refusal.
  let reachedDb = false;
  const countingDb = {
    prepare() {
      reachedDb = true;
      return { bind: () => ({ first: async () => null, run: async () => ({}) }) };
    },
    batch: async () => []
  };
  await signupMod
    .onRequestPost({
      request: jsonReq({ email: "merchant@example.com", password: "longenoughpw" }),
      env: { ...adminEnv, DB: countingDb }
    })
    .catch(() => {});
  assert(reachedDb, "signup still proceeds normally for a non-admin address");

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

  // WhatsApp Embedded Signup — Coexistence history sync (SMB App Data API).
  // Not live yet (waiting on Meta Tech Provider approval), but the logic is
  // built now — cover it so a future refactor can't silently break it.
  const { requestCoexistenceSync, syncCoexistenceHistory } = await import("../functions/_lib/integrations/whatsapp.js");
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

  // P39 — password-reset OTP brute force. The 6-digit code had NO per-email
  // budget: only a per-IP checkRateLimit that fails open when KV is down. The
  // fix reuses the existing `login_attempts` table under a `pwreset:` key.
  {
    const { onRequestPost: resetPost } = await import("../functions/api/auth/reset_password.js");

    // Minimal in-memory D1 covering just the statements this endpoint runs.
    function makeResetDb({ otpHash, failDbOn = null }) {
      const state = { resets: new Map(), attempts: new Map(), passwordWrites: 0 };
      if (otpHash) state.resets.set("user@aura.sa", otpHash);
      const db = {
        prepare(query) {
          return {
            bind(...args) {
              return {
                async first() {
                  if (failDbOn && query.includes(failDbOn)) throw new Error("d1 down");
                  if (query.includes("FROM password_resets")) {
                    const code = state.resets.get(args[0]);
                    return code ? { otp_code: code } : null;
                  }
                  if (query.includes("FROM login_attempts")) {
                    const n = state.attempts.get(args[0]) || 0;
                    return n ? { failed_count: n, locked_until: null } : null;
                  }
                  return null;
                },
                async run() {
                  if (failDbOn && query.includes(failDbOn)) throw new Error("d1 down");
                  if (query.includes("INSERT INTO login_attempts")) {
                    state.attempts.set(args[0], (state.attempts.get(args[0]) || 0) + 1);
                  } else if (query.includes("DELETE FROM login_attempts")) {
                    state.attempts.delete(args[0]);
                  } else if (query.includes("DELETE FROM password_resets")) {
                    state.resets.delete(args[0]);
                  } else if (query.includes("UPDATE accounts")) {
                    state.passwordWrites++;
                  }
                  return { meta: { changes: 1 } };
                }
              };
            }
          };
        }
      };
      return { state, env: { DB: db, SESSION_SECRET: env.SESSION_SECRET } };
    }

    function resetReq(otpCode) {
      return new Request("https://x/api/auth/reset_password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "user@aura.sa", otpCode, newPassword: "brandNewPass1" })
      });
    }

    // The real code, so the "correct code after burn" test is honest.
    const goodOtp = "123456";
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`user@aura.sa:${goodOtp}`)
    );
    const goodHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

    // (a) five wrong guesses burn the pending OTP row
    const burn = makeResetDb({ otpHash: goodHash });
    for (let i = 0; i < 5; i++) {
      const res = await resetPost({ request: resetReq("000000"), env: burn.env });
      assert(res.status === 400, `reset_password rejects wrong OTP attempt #${i + 1}`);
    }
    assert(!burn.state.resets.has("user@aura.sa"), "5 failed OTP attempts burn the pending reset code from D1");
    assert(burn.state.passwordWrites === 0, "no password was written during the failed OTP attempts");

    // (b) the CORRECT code no longer works after the burn
    const afterBurn = await resetPost({ request: resetReq(goodOtp), env: burn.env });
    const afterBurnBody = await afterBurn.json();
    assert(afterBurn.status === 400, "the correct OTP is dead once the code has been burned");
    assert(burn.state.passwordWrites === 0, "a burned OTP cannot change the password even when the code is right");
    assert(
      afterBurnBody.error === "رمز التحقق غير صحيح أو منتهي الصلاحية.",
      "burned / wrong / expired all return the same Arabic message (no enumeration oracle)"
    );

    // (c) the counter check fails CLOSED — a broken counter query must refuse,
    //     never fall through to an unlimited-guess window.
    const broken = makeResetDb({ otpHash: goodHash, failDbOn: "FROM login_attempts" });
    const failClosed = await resetPost({ request: resetReq(goodOtp), env: broken.env });
    assert(failClosed.status === 503, "a failing attempt-counter query refuses the reset (fails closed)");
    assert(broken.state.passwordWrites === 0, "no password write happens when the lockout check itself fails");

    // (d) a correct code on a clean counter still works
    const happy = makeResetDb({ otpHash: goodHash });
    const ok = await resetPost({ request: resetReq(goodOtp), env: happy.env });
    assert(ok.status === 200, "a correct OTP under the failure threshold still resets the password");
    assert(happy.state.passwordWrites === 1, "successful reset writes the new password exactly once");
    assert(!happy.state.attempts.has("pwreset:user@aura.sa"), "successful reset clears the per-email OTP counter");
  }

  // ── P41: Google sign-in must not auto-link an unverified password account ──
  {
    const { onRequestPost: googlePost } = await import("../functions/api/auth/google.js");

    const GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";

    // A stand-in accounts table. `accounts` maps email → merchant_id, exactly
    // like the two real rows: an `m_` id was created by signup.js (password),
    // an `m_g_` id by google.js.
    function makeGoogleDb({ accounts = {}, failSelect = false }) {
      const state = { accounts: { ...accounts }, insertedAccounts: [], insertedMerchants: [] };
      const env = {
        SESSION_SECRET: "test-secret-12345",
        GOOGLE_CLIENT_ID,
        ADMIN_EMAILS: "admin@aura.sa",
        DB: {
          prepare(query) {
            return {
              // P59: trialSeatUsage() scans the table with .all() and no bind.
              async all() {
                if (failSelect) throw new Error("D1_ERROR: accounts unreachable");
                return { results: Object.keys(state.accounts).map((email) => ({ email })) };
              },
              bind(...args) {
                return {
                  async first() {
                    if (query.includes("FROM accounts")) {
                      if (failSelect) throw new Error("D1_ERROR: accounts unreachable");
                      const merchantId = state.accounts[args[0]];
                      return merchantId ? { merchant_id: merchantId } : null;
                    }
                    return null;
                  },
                  async run() {
                    if (query.includes("INTO accounts")) {
                      state.insertedAccounts.push({ merchantId: args[0], email: args[1] });
                      state.accounts[args[1]] = args[0];
                    } else if (query.includes("INTO merchants")) {
                      state.insertedMerchants.push(args[0]);
                    }
                    return { meta: { changes: 1, last_row_id: 1 } };
                  }
                };
              }
            };
          }
        }
      };
      return { env, state };
    }

    // Stub Google's tokeninfo endpoint: the credential string IS the subject,
    // so each test can mint a distinct Google identity.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const credential = decodeURIComponent(String(url).split("id_token=")[1] || "");
      const [sub, email] = credential.split("|");
      if (!sub || !email) return { ok: false, json: async () => ({}) };
      return {
        ok: true,
        json: async () => ({
          aud: GOOGLE_CLIENT_ID,
          sub,
          email,
          email_verified: "true",
          name: "تاجر تجريبي"
        })
      };
    };

    const googleReq = (credential) =>
      new Request("https://x/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential })
      });

    try {
      // (a) THE ATTACK: an attacker already registered the victim's address via
      //     signup (an `m_` row). Google sign-in must NOT join that account.
      const hijack = makeGoogleDb({ accounts: { "victim@aura.sa": "m_abcdef123456" } });
      const hijackRes = await googlePost({ request: googleReq("sub-victim|victim@aura.sa"), env: hijack.env });
      const hijackBody = await hijackRes.json();
      assert(hijackRes.status === 409, "P41: Google sign-in is refused when a password account holds the address");
      assert(
        hijackBody.code === "PASSWORD_ACCOUNT_EXISTS",
        "P41: the refusal carries PASSWORD_ACCOUNT_EXISTS, not a session"
      );
      assert(
        !hijackRes.headers.get("Set-Cookie"),
        "P41: no session cookie is issued for the refused password account"
      );
      assert(
        hijack.state.insertedAccounts.length === 0,
        "P41: the refusal creates no parallel account row either (no silent fork)"
      );
      assert(
        /كلمة المرور/.test(hijackBody.error),
        "P41: the Arabic message points the user at password login"
      );

      // (b) REGRESSION — the two real rows must both still sign in.
      //     shssk.16@gmail.com is an `m_g_` (Google-created) account: Google
      //     signs it back into the SAME merchant_id, no new row.
      const real = makeGoogleDb({
        accounts: { "shssk.16@gmail.com": "m_g_101234567890123", "info@aurateam3.com": "m_71cbd12e0f4a" }
      });
      const googleAcctRes = await googlePost({
        request: googleReq("101234567890123|shssk.16@gmail.com"),
        env: real.env
      });
      const googleAcctBody = await googleAcctRes.json();
      assert(googleAcctRes.status === 200, "P41 regression: the existing m_g_ Google account still signs in");
      assert(
        googleAcctBody.storeId === "m_g_101234567890123",
        "P41 regression: it lands on its existing merchant_id, not a new one"
      );
      assert(
        Boolean(googleAcctRes.headers.get("Set-Cookie")),
        "P41 regression: the Google account still gets its session cookie"
      );
      assert(real.state.insertedAccounts.length === 0, "P41 regression: no duplicate account row is created");

      //     info@aurateam3.com is an `m_` (password) account. Its login path is
      //     /api/auth/login with its password — unchanged by this commit — and
      //     Google is now refused for it, which is the whole point of P41.
      const passwordAcctRes = await googlePost({
        request: googleReq("sub-info|info@aurateam3.com"),
        env: real.env
      });
      assert(
        passwordAcctRes.status === 409,
        "P41: the m_ password account is refused via Google (it still logs in with its password)"
      );
      assert(
        real.state.accounts["info@aurateam3.com"] === "m_71cbd12e0f4a",
        "P41: the password account row is left completely untouched"
      );

      // (c) a brand-new Google user is still provisioned normally.
      const fresh = makeGoogleDb({});
      const freshRes = await googlePost({ request: googleReq("998877665544332|new@aura.sa"), env: fresh.env });
      const freshBody = await freshRes.json();
      assert(freshRes.status === 200, "P41: a first-time Google user is still signed in");
      assert(
        freshBody.storeId.startsWith("m_g_"),
        "P41: a new Google account is provisioned with the m_g_ provider prefix"
      );
      assert(fresh.state.insertedAccounts.length === 1, "P41: exactly one accounts row is created for a new user");
      assert(fresh.state.insertedMerchants.length === 1, "P41: its merchants row is created too");

      // (d) FAIL CLOSED — if the accounts lookup itself errors, refuse. The old
      //     code swallowed it with .catch(() => null) and provisioned a second
      //     account for an address that may already belong to someone.
      const broken = makeGoogleDb({ accounts: { "victim@aura.sa": "m_abcdef123456" }, failSelect: true });
      const brokenRes = await googlePost({ request: googleReq("sub-x|victim@aura.sa"), env: broken.env });
      assert(brokenRes.status === 503, "P41: an unreadable accounts table refuses the sign-in (fails closed)");
      assert(
        broken.state.insertedAccounts.length === 0,
        "P41: a failed lookup never provisions an account behind the existing one"
      );
      assert(!brokenRes.headers.get("Set-Cookie"), "P41: no session is issued when the lookup fails");

      // (e) an m_ id can never be mistaken for an m_g_ id: `m_` ids are
      //     `m_` + uuid hex, and `g` is not a hex digit.
      const { GOOGLE_MERCHANT_PREFIX } = await import("../functions/_lib/core/db.js");
      let hexIdsLookGoogle = false;
      for (let i = 0; i < 200; i++) {
        if (`m_${crypto.randomUUID().slice(0, 12)}`.startsWith(GOOGLE_MERCHANT_PREFIX)) hexIdsLookGoogle = true;
      }
      assert(!hexIdsLookGoogle, "P41: a signup-generated m_ merchant id can never collide with the m_g_ prefix");
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  // ── P59 / G4: التفاف على سقف التجربة المجانية ──
  //
  // ثقبان حقيقيان أُغلقا:
  //   ١. صيغ بديلة لنفس الصندوق البريدي (+tag، ونقاط جيميل) تفتح مقاعد جديدة.
  //   ٢. google.js كان ينشئ حساباً بلا أي احتساب للسقف — التفاف كامل.
  {
    const { normalizeEmailForDedupe, trialSeatUsage } = await import("../functions/_lib/core/db.js");

    // (أ) التطبيع نفسه
    assert(normalizeEmailForDedupe("Me+1@Gmail.com") === "me@gmail.com", "P59: +tag يُحذف");
    assert(normalizeEmailForDedupe("m.e@gmail.com") === "me@gmail.com", "P59: نقاط جيميل تُحذف");
    assert(
      normalizeEmailForDedupe("m.e+x@googlemail.com") === "me@gmail.com",
      "P59: googlemail يُوحَّد مع gmail، والنقاط والوسم يُحذفان"
    );
    // القاعدة الحاسمة: النقاط تُحذف بجيميل **فقط**. تعميمها يدمج أشخاصاً مختلفين.
    assert(
      normalizeEmailForDedupe("a.b@aura.sa") === "a.b@aura.sa",
      "P59: النقاط تبقى حرفية بالنطاقات غير جيميل (Workspace/غيره يعاملها كأحرف حقيقية)"
    );
    assert(normalizeEmailForDedupe("a.b+t@aura.sa") === "a.b@aura.sa", "P59: +tag يُحذف بكل النطاقات");
    assert(normalizeEmailForDedupe("+only@gmail.com") === "+only@gmail.com", "P59: لا نُفرغ جزءاً محلياً كله وسم");
    assert(normalizeEmailForDedupe("") === "", "P59: التطبيع آمن مع مدخل فارغ");

    // (ب) عدّاد المقاعد: الأدمن لا يحتسب، والصيغة البديلة تُكشف كمكرّر
    const seatDb = (emails) => ({
      DB: { prepare: () => ({ all: async () => ({ results: emails.map((email) => ({ email })) }) }) }
    });
    const usage = await trialSeatUsage(
      seatDb(["admin@aura.sa", "me@gmail.com", "other@aura.sa"]),
      "M.E+9@gmail.com",
      ["admin@aura.sa"]
    );
    assert(usage.count === 2, `P59: حسابات الأدمن لا تحتسب من المقاعد (got ${usage.count})`);
    assert(usage.duplicate, "P59: صيغة بديلة لنفس صندوق جيميل تُكشف كمكرّر");
    const distinct = await trialSeatUsage(seatDb(["a.b@aura.sa"]), "ab@aura.sa", []);
    assert(!distinct.duplicate, "P59: عنوانان يختلفان بنقطة على نطاق غير جيميل ليسا نفس الشخص");

    // (ج) signup.js يرفض الصيغة البديلة بنفس رسالة «مسجّل مسبقاً»
    const { onRequestPost: signupPost } = await import("../functions/api/auth/signup.js");
    let signupInserted = 0;
    const signupEnv = (emails) => ({
      SESSION_SECRET: "test-secret-12345",
      ADMIN_EMAILS: "admin@aura.sa",
      DB: {
        prepare: () => ({
          all: async () => ({ results: emails.map((email) => ({ email })) }),
          bind: () => ({ first: async () => null, run: async () => ({}) })
        }),
        batch: async () => {
          signupInserted += 1;
          return [];
        }
      }
    });
    const signupJson = (body) =>
      new Request("https://x/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

    const dupRes = await signupPost({
      request: signupJson({ email: "M.E+2@gmail.com", password: "longenoughpw" }),
      env: signupEnv(["me@gmail.com"])
    });
    assert(dupRes.status === 409, `P59: signup يرفض الصيغة البديلة لبريد مسجّل (got ${dupRes.status})`);
    assert(signupInserted === 0, "P59: لا إدراج يحدث عند رفض المكرّر");
    assert(
      (await dupRes.json()).error === "هذا البريد مسجّل مسبقاً — سجّل دخول بدل ذلك.",
      "P59: نفس رسالة «مسجّل مسبقاً» — لا تسريب أن السبب تطبيع"
    );

    // السقف نفسه ما زال يعمل على العدد الحقيقي
    const full = Array.from({ length: 20 }, (_, i) => `m${i}@aura.sa`);
    const fullRes = await signupPost({
      request: signupJson({ email: "new@aura.sa", password: "longenoughpw" }),
      env: signupEnv(full)
    });
    assert(fullRes.status === 403, `P59: السقف ما زال يُطبَّق عند ٢٠ حساباً (got ${fullRes.status})`);
    assert((await fullRes.json()).code === "TRIAL_FULL", "P59: السقف يرد بـTRIAL_FULL");

    // وأقل من السقف يمرّ فعلاً — الفحص مستهدف لا رفض شامل
    const okRes = await signupPost({
      request: signupJson({ email: "fresh@aura.sa", password: "longenoughpw" }),
      env: signupEnv(["me@gmail.com"])
    });
    assert(okRes.status === 200, `P59: تسجيل مشروع تحت السقف ينجح (got ${okRes.status})`);

    // (د) فشل مغلق: جدول حسابات غير مقروء = رفض، لا "صفر حسابات"
    const brokenRes = await signupPost({
      request: signupJson({ email: "x@aura.sa", password: "longenoughpw" }),
      env: {
        SESSION_SECRET: "test-secret-12345",
        ADMIN_EMAILS: "admin@aura.sa",
        DB: {
          prepare: () => ({
            all: async () => {
              throw new Error("D1_ERROR");
            }
          })
        }
      }
    });
    assert(brokenRes.status === 503, `P59: فشل قراءة الحسابات يرفض التسجيل (fail closed, got ${brokenRes.status})`);

    // (هـ) google.js — المسار الذي كان يلتف على السقف كلياً
    const { onRequestPost: googleCapPost } = await import("../functions/api/auth/google.js");
    const realFetch2 = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const credential = decodeURIComponent(String(url).split("id_token=")[1] || "");
      const [sub, email] = credential.split("|");
      if (!sub || !email) return { ok: false, json: async () => ({}) };
      return {
        ok: true,
        json: async () => ({
          aud: "cap-client-id",
          sub,
          email,
          email_verified: "true",
          name: "تاجر"
        })
      };
    };
    try {
      const capState = { inserts: 0, accounts: Array.from({ length: 20 }, (_, i) => `m${i}@aura.sa`) };
      const capEnv = {
        SESSION_SECRET: "test-secret-12345",
        GOOGLE_CLIENT_ID: "cap-client-id",
        ADMIN_EMAILS: "admin@aura.sa",
        DB: {
          prepare: (query) => ({
            all: async () => ({ results: capState.accounts.map((email) => ({ email })) }),
            bind: () => ({
              first: async () => null,
              run: async () => {
                if (String(query).includes("INTO accounts")) capState.inserts += 1;
                return {};
              }
            })
          })
        }
      };
      const gReq = (credential) =>
        new Request("https://x/api/auth/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential })
        });

      const gFull = await googleCapPost({ request: gReq("sub-new|newbie@aura.sa"), env: capEnv });
      const gFullBody = await gFull.json();
      assert(gFull.status === 403, `P59: google.js يخضع لسقف التجربة عند إنشاء حساب (got ${gFull.status})`);
      assert(gFullBody.code === "TRIAL_FULL", "P59: رفض جوجل عند الامتلاء يحمل TRIAL_FULL");
      assert(capState.inserts === 0, "P59: لا حساب يُنشأ بجوجل بعد امتلاء المقاعد");

      // وتحت السقف ما زال ينشئ الحساب — لم نكسر تسجيل الدخول بجوجل
      capState.accounts = ["one@aura.sa"];
      const gOk = await googleCapPost({ request: gReq("sub-ok|ok@aura.sa"), env: capEnv });
      assert(gOk.status === 200, `P59: تسجيل جوجل جديد تحت السقف ما زال ينجح (got ${gOk.status})`);
      assert(capState.inserts === 1, "P59: تسجيل جوجل تحت السقف ينشئ حساباً واحداً");
    } finally {
      globalThis.fetch = realFetch2;
    }
  }

  // ── إنستغرام (docs/INSTAGRAM_PLAN.md المرحلة ٥) ────────────────────────
  {
    const ig = await import("../functions/_lib/integrations/instagram.js");

    // T2 — التوقيع: fail closed بلا سر، ورفض التوقيع الخاطئ، وقبول الصحيح.
    const body = JSON.stringify({ object: "instagram", entry: [] });
    const secret = "ig-app-secret-test";
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const validSig =
      "sha256=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");

    assert(
      (await ig.verifyIgSignature(body, validSig, secret)) === true,
      "IG-T2: توقيع صحيح يُقبل"
    );
    assert(
      (await ig.verifyIgSignature(body, validSig, "")) === false,
      "IG-T2: fail closed — بلا App Secret يُرفض كل شيء (S1)"
    );
    assert(
      (await ig.verifyIgSignature(body, "sha256=deadbeef", secret)) === false,
      "IG-T2: توقيع خاطئ يُرفض"
    );
    assert(
      (await ig.verifyIgSignature(body, null, secret)) === false,
      "IG-T2: غياب ترويسة التوقيع يُرفض"
    );

    // T5 — الشكلان: Instagram Login (value مباشرة) وFacebook Login (changes[]).
    const direct = ig.parseIgComments({
      entry: [
        {
          id: "IG_ACCOUNT_1",
          field: "comments",
          value: { id: "C1", text: "كم السعر؟", from: { id: "U1", username: "ahmed" } }
        }
      ]
    });
    assert(
      direct.length === 1 && direct[0].commentId === "C1" && direct[0].igId === "IG_ACCOUNT_1",
      "IG-T5: شكل Instagram Login (entry.value) يُحلَّل — value.id لا comment_id"
    );

    const viaChanges = ig.parseIgComments({
      entry: [
        {
          id: "IG_ACCOUNT_2",
          changes: [{ field: "comments", value: { comment_id: "C2", text: "شكراً" } }]
        }
      ]
    });
    assert(
      viaChanges.length === 1 && viaChanges[0].commentId === "C2",
      "IG-T5: شكل Facebook Login (changes[]) يُحلَّل دفاعياً كذلك"
    );

    // T1 — العزل: igId يُحمل مع كل حدث؛ بدونه لا يمكن نسبة الحدث لتاجره.
    assert(
      direct[0].igId === "IG_ACCOUNT_1" && viaChanges[0].igId === "IG_ACCOUNT_2",
      "IG-T1: entry[].id (مفتاح ربط التاجر) محفوظ بكل حدث — درس phone_number_id"
    );

    // T3 — is_echo: رسالتنا نحن لا تُعالَج إطلاقاً (حلقة رد ذاتي).
    const msgs = ig.parseIgMessages({
      entry: [
        {
          id: "IG_ACCOUNT_1",
          messaging: [
            { sender: { id: "U1" }, message: { mid: "M1", text: "هلا" } },
            { sender: { id: "IG_ACCOUNT_1" }, message: { mid: "M2", text: "رد البوت", is_echo: true } }
          ]
        }
      ]
    });
    assert(
      msgs.length === 1 && msgs[0].mid === "M1",
      "IG-T3: is_echo يُتجاهل — لا حلقة رد ذاتية تحرق الحصة"
    );

    // SSRF — نفس قفل whatsapp.js: مضيف خارج القائمة يُرفض قبل لصق التوكن.
    let ssrfBlocked = false;
    try {
      ig.assertIgUrlAllowed("https://evilinstagram.com/steal");
    } catch {
      ssrfBlocked = true;
    }
    assert(ssrfBlocked, "IG-SSRF: مضيف مشابه (evilinstagram.com) يُرفض — لا مطابقة بالنهاية");

    let httpBlocked = false;
    try {
      ig.assertIgUrlAllowed("http://graph.instagram.com/x");
    } catch {
      httpBlocked = true;
    }
    assert(httpBlocked, "IG-SSRF: مخطط http يُرفض قبل إرسال أي بيانات اعتماد");

    assert(
      ig.assertIgUrlAllowed("https://graph.instagram.com/v25.0/me").startsWith("https://graph.instagram.com/"),
      "IG-SSRF: المضيف الرسمي يُقبل"
    );

    // T7 — البوابة: المحوّل لا يصدّر أي مسار نشر مباشر يتجاوز review_queue.
    const wh = await import("../functions/api/instagram/webhook.js");
    assert(
      typeof wh.onRequestGet === "function" && typeof wh.onRequestPost === "function",
      "IG: webhook.js يصدّر المصافحة والاستقبال"
    );
    const whSource = await (await import("node:fs/promises")).readFile(
      new URL("../functions/api/instagram/webhook.js", import.meta.url),
      "utf8"
    );
    assert(
      whSource.includes("enqueue(") && !/\bsend\s*\(\s*env/.test(whSource),
      "IG-T7: صفر نشر مباشر من الويبهوك — كل رد يمرّ بـreview_queue (الأخطر لو كُسر)"
    );
  }

  // ── D4: كتالوج الأخطاء العربية (docs/PARALLEL_TRACKS.md §أ.٤) ──
  {
    const { classifyError, messageFor, statusFor, ERROR_CATALOG } = await import(
      "../functions/_lib/core/errors.js"
    );

    // كل رسالة تصل التاجر عربية — لا إنجليزية ولا كود خام. هذا جوهر D4:
    // مدخل واحد إنجليزي يكفي ليرى تاجر رسالة لا يفهمها.
    const nonArabic = Object.entries(ERROR_CATALOG).filter(
      ([, v]) => !/[؀-ۿ]/.test(v.message)
    );
    assert(nonArabic.length === 0, `D4: كل رسائل الكتالوج عربية (المخالف: ${nonArabic.map(([k]) => k).join(", ")})`);

    // التمييز الذي يهم عملياً: "مزحوم" (أعد المحاولة) ≠ "معطّل" (لا تعيد).
    assert(
      classifyError(new Error("Groq 429: rate limit exceeded")) === "AI_BUSY",
      "D4: خطأ 429 من مزود يُصنَّف AI_BUSY (أعد المحاولة)"
    );
    assert(
      classifyError(new Error("No AI backend available. Configure at least one")) === "AI_UNAVAILABLE",
      "D4: غياب كل المزودين يُصنَّف AI_UNAVAILABLE (لا فائدة من الإعادة)"
    );
    assert(
      classifyError(new Error("D1_ERROR: no such table: merchants")) === "DB_UNAVAILABLE",
      "D4: عطل قاعدة البيانات يُصنَّف DB_UNAVAILABLE"
    );
    assert(
      classifyError(new Error("fetch failed")) === "SYNC_FAILED",
      "D4: عطل الشبكة يُصنَّف SYNC_FAILED"
    );

    // الارتداد الآمن: خطأ مجهول يعطي رسالة صحيحة أعمّ، لا رسالة خاطئة واثقة.
    assert(
      classifyError(new Error("something nobody predicted")) === "INTERNAL",
      "D4: الخطأ المجهول يرتد لـINTERNAL بدل تصنيف مخترع"
    );
    assert(
      /[؀-ۿ]/.test(messageFor("CODE_DOES_NOT_EXIST")) && statusFor("CODE_DOES_NOT_EXIST") === 500,
      "D4: كود غير معروف يرتد لرسالة عربية وحالة 500، لا undefined"
    );
  }

  // ── النشر بعد الاعتماد (docs/INSTAGRAM_PLAN.md §٢.٢) ────────────────────
  {
    const { publishApproved } = await import("../functions/_lib/services/publishApproved.js");

    // DB وهمي: ig_connections تربط IG_A بالتاجر m_a فقط، وrecordPublishResult
    // يسجّل ما وصله.
    let recorded = null;
    const pubDb = (igOwner) => ({
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => {
                if (/FROM ig_connections WHERE ig_user_id/.test(sql)) {
                  return args[0] === "IG_A"
                    ? { merchant_id: igOwner, ig_user_id: "IG_A", access_token: "tok" }
                    : null;
                }
                if (/UPDATE review_queue/.test(sql)) {
                  recorded = { error: args[0], externalId: args[1] };
                  return { id: args[3], merchant_id: args[4] };
                }
                return null;
              },
              run: async () => ({ meta: {} })
            };
          }
        };
      }
    });

    const igRow = (payload, overrides = {}) => ({
      id: 1,
      merchant_id: "m_a",
      kind: "social_reply",
      payload: JSON.stringify(payload),
      ...overrides
    });

    // النافذة انتهت ⇒ رفض قبل أي نداء لـMeta، برسالة عربية لا خطأ مزوّد غامض.
    recorded = null;
    const expired = await publishApproved(
      { DB: pubDb("m_a") },
      igRow({
        channel: "instagram",
        mode: "comment_reply",
        igId: "IG_A",
        commentId: "C1",
        draft: "أهلين",
        expiresAt: new Date(Date.now() - 1000).toISOString()
      })
    );
    assert(
      expired.published === false && /فات وقت الرد/.test(expired.error || ""),
      "PUB-1: عنصر فاتت نافذته يُرفض برسالة عربية قبل نداء Meta"
    );

    // عدم تطابق التاجر ⇒ رفض. حمولة تشير لحساب إنستغرام يملكه تاجر آخر لا يجوز
    // أن ترسل باسمه — هذا تسريب عبر المستأجرين لو مرّ.
    recorded = null;
    const mismatch = await publishApproved(
      { DB: pubDb("m_OTHER") },
      igRow({
        channel: "instagram",
        mode: "comment_reply",
        igId: "IG_A",
        commentId: "C1",
        draft: "أهلين"
      })
    );
    assert(
      mismatch.published === false && /عدم تطابق/.test(mismatch.error || ""),
      "PUB-2: حساب إنستغرام يخص تاجراً آخر ⇒ رفض الإرسال (عزل)"
    );

    // حساب غير مربوط ⇒ رسالة عربية واضحة، لا استثناء يتسرب للمستدعي.
    recorded = null;
    const unlinked = await publishApproved(
      { DB: pubDb("m_a") },
      igRow({ channel: "instagram", mode: "dm", igId: "IG_UNKNOWN", recipientId: "U1", draft: "x" })
    );
    assert(
      unlinked.published === false && /غير مربوط/.test(unlinked.error || ""),
      "PUB-3: حساب غير مربوط ⇒ خطأ عربي مسجّل، بلا رمي للمستدعي"
    );

    // قناة غير مدعومة ⇒ رفض صريح لا نشر صامت.
    recorded = null;
    const badChannel = await publishApproved(
      { DB: pubDb("m_a") },
      igRow({ channel: "tiktok", draft: "x" })
    );
    assert(
      badChannel.published === false && /قناة غير مدعومة/.test(badChannel.error || ""),
      "PUB-4: قناة غير مدعومة تُرفض صراحةً"
    );

    // نوع بلا وجهة خارجية (تقرير) ⇒ الاعتماد نفسه هو النتيجة.
    const report = await publishApproved(
      { DB: pubDb("m_a") },
      { id: 9, merchant_id: "m_a", kind: "report", payload: "{}" }
    );
    assert(
      report.published === true && report.externalId === null,
      "PUB-5: التقرير لا وجهة نشر خارجية له — الاعتماد يكفي"
    );

    // فشل النشر يُسجَّل ولا يُرمى — الاعتماد البشري لا يُبطله عطل شبكة.
    assert(
      typeof mismatch.error === "string" && mismatch.published === false,
      "PUB-6: فشل النشر يعود كنتيجة مسجّلة، لا كاستثناء يُبطل الاعتماد"
    );
  }

  // ── المرحلة ١: سحب كتالوج سلة (services/catalog.js + توجيه kind) ──────────
  {
    const { syncCatalogPage, listCatalog, getCatalogItem } = await import(
      "../functions/_lib/services/catalog.js"
    );

    // DB وهمي يسجّل كل استعلام مع قيمه المربوطة.
    function catalogDb(log) {
      const rec = (sql) => ({
        bind: (...args) => {
          log.push({ sql, args });
          return {
            run: async () => ({}),
            first: async () => null,
            all: async () => ({ results: [] }),
            _sql: sql,
            _args: args
          };
        }
      });
      return {
        prepare: rec,
        batch: async (stmts) => {
          for (const s of stmts) log.push({ sql: s._sql, args: s._args, batched: true });
          return [];
        }
      };
    }

    const page1 = {
      data: [
        { id: "1", sku: "SKU-A", name: "عباية", price: { amount: 300, currency: "SAR" }, description: "وصف أصلي", categories: [{ name: "عبايات" }] },
        { id: "2", name: "منتج بلا رمز", price: 100 },          // بلا SKU
        { id: "3", sku: "SKU-B", name: "شيلة" },
        { id: "4", sku: "   ", name: "رمز فاضي" }                // يُعدّ كذلك
      ],
      pagination: { currentPage: 1, totalPages: 2 }
    };

    const log = [];
    const res = await syncCatalogPage(
      { DB: catalogDb(log) },
      { merchantId: "m_a", page: 1, fetchPage: async () => page1 }
    );

    assert(res.imported === 2, "CAT-1: صفّان صالحان يُدرجان من الصفحة");
    assert(
      res.skippedNoSku === 2 && res.received === 4,
      "CAT-2: منتجات بلا SKU تُعدّ صراحةً (٢) ولا تُسقط صامتة"
    );
    assert(
      res.hasMore === true && res.nextPage === 2,
      "CAT-3: pagination تحدد الصفحة التالية — صفحة واحدة لكل تِك (حد سلة)"
    );

    const writes = log.filter((l) => l.batched && /INSERT INTO store_products/.test(l.sql));
    assert(
      writes.length === 2 && writes.every((w) => /merchant_id/.test(w.sql) && w.args[0] === "m_a"),
      "CAT-4: كل كتابة على store_products تحمل merchant_id للتاجر الصحيح"
    );
    assert(
      writes.every((w) => /ON CONFLICT\(merchant_id, sku\)/.test(w.sql)),
      "CAT-5: مفتاح التعارض (merchant_id, sku) — SKU مكرر بين متجرين لا يدهس"
    );
    // الوصف الأصلي محفوظ — بدونه ميزة التراجع مستحيلة (المخاطرة ٤ بالخطة).
    assert(
      writes[0].args.includes("وصف أصلي"),
      "CAT-6: current_description يحفظ الوصف الأصلي من سلة"
    );

    // آخر صفحة: بلا nextPage ⇒ الـcron ينهي الوظيفة.
    const last = await syncCatalogPage(
      { DB: catalogDb([]) },
      {
        merchantId: "m_a",
        page: 2,
        fetchPage: async () => ({ data: [{ sku: "S", name: "n" }], pagination: { currentPage: 2, totalPages: 2 } })
      }
    );
    assert(last.hasMore === false && last.nextPage === null, "CAT-7: آخر صفحة توقف السحب");

    // العزل: قراءة بلا merchantId ترمي (fail closed) لا ترجع كتالوج الجميع.
    let threw = false;
    try {
      await listCatalog({ DB: catalogDb([]) }, { merchantId: "" });
    } catch {
      threw = true;
    }
    assert(threw, "CAT-8: listCatalog بلا merchantId ترمي — لا قراءة عابرة للمستأجرين");

    const readLog = [];
    await listCatalog({ DB: catalogDb(readLog) }, { merchantId: "m_b", limit: 10 });
    await getCatalogItem({ DB: catalogDb(readLog) }, { merchantId: "m_b", sku: "SKU-A" });
    assert(
      readLog.length === 2 && readLog.every((r) => /merchant_id = \?/.test(r.sql) && r.args[0] === "m_b"),
      "CAT-9: كل قراءة من store_products مشروطة بـmerchant_id"
    );

    // التوجيه: وظيفة catalog_sync لا تُرى كصف توليد، والمسار الحالي سليم.
    const { claimNextCatalogSyncJob, getActiveJobByKind } = await import(
      "../functions/_lib/core/db.js"
    );
    const routeLog = [];
    const routeDb = {
      DB: {
        prepare: (sql) => ({
          bind: (...args) => {
            routeLog.push({ sql, args });
            return { first: async () => null, run: async () => ({}), all: async () => ({ results: [] }) };
          },
          first: async () => {
            routeLog.push({ sql, args: [] });
            return null;
          }
        })
      }
    };
    await claimNextCatalogSyncJob(routeDb);
    assert(
      routeLog.some((r) => /kind = 'catalog_sync'/.test(r.sql) && /status = 'running'/.test(r.sql)),
      "CAT-10: الـcron يلتقط وظائف catalog_sync فقط بالنوع — مسار seo_generate بلا مساس"
    );
    routeLog.length = 0;
    await getActiveJobByKind(routeDb, "m_c", "catalog_sync");
    assert(
      routeLog.length === 1 && /merchant_id = \?/.test(routeLog[0].sql) && routeLog[0].args[0] === "m_c",
      "CAT-11: فحص الوظيفة النشطة مشروط بالتاجر — يمنع وظيفة ثانية لنفس المتجر"
    );

    // ── الصفحة الأولى فوراً (تجربة التاجر) ───────────────────────────────
    // ثلاثة أشياء تُختبَر لأن كسرها مكلف:
    //  ١. **طلب سلة واحد** عند البدء — حلقة هنا تتجاوز ١ طلب/ثانية فتوقف
    //     اتصال المتجر كاملاً لا الطلب وحده.
    //  ٢. hasMore=false ⇒ **لا وظيفة** تنتظر تِكاً بلا شغل.
    //  ٣. فشل الصفحة الأولى ⇒ **لا وظيفة** توهم بنجاح ولا تحجز الحارس.
    const { syncFirstPage } = await import("../functions/api/store/catalog/sync.js");

    /** env وهمي يسجّل كل كتابة على bulk_jobs (إنشاء الوظيفة/تقديم الـcursor). */
    function jobEnv(jobLog) {
      return {
        DB: {
          prepare: (sql) => ({
            bind: (...args) => {
              jobLog.push({ sql, args });
              return { run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) };
            }
          })
        }
      };
    }

    // متجر كبير: صفحة أولى + وظيفة للباقي، والـcursor على الصفحة ٢.
    const bigLog = [];
    let bigCalls = 0;
    const bigPages = [];
    const big = await syncFirstPage(jobEnv(bigLog), "m_a", {
      syncPage: async (_env, opts) => {
        bigCalls++;
        bigPages.push(opts.page);
        return { page: opts.page, received: 60, imported: 60, skippedNoSku: 0, hasMore: true, nextPage: 2 };
      }
    });
    assert(
      bigCalls === 1 && bigPages[0] === 1,
      "CAT-12: طلب سلة **واحد** عند البدء (الصفحة ١ فقط) — لا حلقة تتجاوز حد ١ طلب/ثانية"
    );
    assert(
      big.imported === 60 && big.hasMore === true && typeof big.jobId === "string",
      "CAT-13: متجر كبير — التاجر يشوف ٦٠ منتجاً فوراً ووظيفة تكمل الباقي"
    );
    assert(
      bigLog.some((r) => /INSERT INTO bulk_jobs/.test(r.sql) && r.args.includes("m_a")) &&
        bigLog.some((r) => /UPDATE bulk_jobs SET/.test(r.sql) && r.args[0] === "2"),
      "CAT-14: الوظيفة تُنشأ للتاجر نفسه والـcursor يبدأ من الصفحة ٢ — لا إعادة سحب الصفحة ١"
    );

    // متجر صغير: صفحة واحدة تكفي ⇒ لا وظيفة إطلاقاً.
    const smallLog = [];
    let smallCalls = 0;
    const small = await syncFirstPage(jobEnv(smallLog), "m_b", {
      syncPage: async () => {
        smallCalls++;
        return { page: 1, received: 12, imported: 12, skippedNoSku: 0, hasMore: false, nextPage: null };
      }
    });
    assert(
      smallCalls === 1 && small.imported === 12 && small.hasMore === false && small.jobId === null,
      "CAT-15: متجر بصفحة واحدة ينتهي فوراً — لا وظيفة معلّقة تنتظر cron بلا داعٍ"
    );
    assert(
      !smallLog.some((r) => /bulk_jobs/.test(r.sql)),
      "CAT-16: hasMore=false ⇒ صفر كتابات على bulk_jobs"
    );

    // فشل الصفحة الأولى: يُرمى للمستدعي، ولا وظيفة تُنشأ.
    const failLog = [];
    let failThrew = false;
    try {
      await syncFirstPage(jobEnv(failLog), "m_c", {
        syncPage: async () => {
          throw new Error("salla 401");
        }
      });
    } catch {
      failThrew = true;
    }
    assert(
      failThrew && !failLog.some((r) => /bulk_jobs/.test(r.sql)),
      "CAT-17: فشل الصفحة الأولى لا يُنشئ وظيفة — لا نجاح موهوم ولا حارس محجوز"
    );
  }

  // ── شخصية الوكيل من البيانات (migrations/0021_agent_profiles.sql) ──────────
  // الأهم هنا: سياسة الأسعار. أورا ممنوعة من ذكر رقم، والتاجر مسموح له —
  // نفس الكود بقرارين. لو انقلب هذا الشرط، أورا تخترع أسعاراً للعملاء.
  {
    const { buildAgentPrompt } = await import("../functions/_lib/ai/persona.js");

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

    const { saveAgentProfile } = await import("../functions/_lib/core/db.js");
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

  // ── بصمة المتجر (المرحلة ٣ من docs/PLAN_BULK_SEO.md) ───────────────────────
  // ثلاثة أشياء تُختبَر لأن كسرها صامت ومكلف:
  //  ١. **استدعاء AI واحد لا ٤٠** — الخطأ هنا يحرق حصة التاجر كاملة بضغطة زر.
  //  ٢. **بصمة غير معتمَدة لا تُحقن** — الحقن قبل الاعتماد يطبّق قرار نموذج على
  //     ٢٠٠ منتج بلا موافقة إنسان.
  //  ٣. **بلا بصمة السلوك كما كان** — الجدول (0019) غير مطبَّق بعد، فأي اعتماد
  //     على وجوده يُسقط توليد المحتوى للجميع.
  {
    const {
      buildProfile,
      getProfile,
      approveProfile,
      profileToPromptBlock,
      normalizeProfile
    } = await import("../functions/_lib/services/storeProfile.js");
    const { approvedProfileBlock, buildSeoSystem } = await import("../functions/api/copy.js");

    const SAMPLE = [
      { name: "عباية كلوش كريب", category: "عبايات", current_description: "عباية كريب ياباني بقصة كلوش." },
      { name: "قهوة إثيوبية", category: "قهوة", current_description: "حبوب مغسولة بنكهة فاكهية." }
    ];
    const MODEL_JSON = JSON.stringify({
      categories: ["عبايات", "قهوة مختصة"],
      audience: "نساء سعوديات يهتمن بالخامة",
      toneNotes: ["جمل قصيرة", "تبدأ بالخامة"],
      vocabulary: ["كريب ياباني", "مغسولة"],
      forbidden: ["مبالغة إعلانية"],
      anchorKeywords: ["أصلي", "فاخر"]
    });

    /** DB وهمي يسجّل كل استعلام — نتحقق من العزل بالنص لا بالنية. */
    function profileDb(log, { sample = SAMPLE, row = null } = {}) {
      return {
        prepare(sql) {
          return {
            bind(...args) {
              log.push({ sql, args });
              return {
                all: async () => ({ results: sample }),
                first: async () => row,
                run: async () => ({ meta: { changes: 1 } })
              };
            }
          };
        }
      };
    }

    // ① استدعاء AI واحد على العيّنة كلها — لا واحد لكل منتج.
    const buildLog = [];
    let aiCalls = 0;
    const built = await buildProfile(
      { DB: profileDb(buildLog) },
      {
        merchantId: "m_1",
        ask: async () => {
          aiCalls++;
          return MODEL_JSON;
        }
      }
    );
    assert(aiCalls === 1, `SP-1: buildProfile يستدعي النموذج مرة واحدة فقط (${aiCalls})`);
    assert(built.status === "draft", "SP-2: البصمة المبنية تُخزَّن مسودة لا معتمَدة");
    assert(
      buildLog.every((q) => /merchant_id/.test(q.sql)) && buildLog.every((q) => q.args[0] === "m_1"),
      "SP-3: كل استعلام بـbuildProfile معزول بـmerchant_id"
    );
    assert(
      buildLog.some((q) => /FROM store_products/.test(q.sql) && q.args[1] === 40),
      "SP-4: العيّنة مقيّدة بـ٤٠ منتج كحد أقصى"
    );

    // العزل fail-closed: بلا merchantId ترمي، لا تقرأ منتجات الجميع.
    let threwProfile = false;
    try {
      await buildProfile({ DB: profileDb([]) }, { merchantId: "", ask: async () => MODEL_JSON });
    } catch {
      threwProfile = true;
    }
    assert(threwProfile, "SP-5: buildProfile بلا merchantId ترمي (fail closed)");

    // ② بوابة الاعتماد — الفرق بين draft وapproved.
    const draftRow = { profile: MODEL_JSON, status: "draft", source_sample: 2, updated_at: "x" };
    const approvedRow = { ...draftRow, status: "approved" };

    const draft = await getProfile({ DB: profileDb([], { row: draftRow }) }, { merchantId: "m_1" });
    const approved = await getProfile({ DB: profileDb([], { row: approvedRow }) }, { merchantId: "m_1" });
    assert(approvedProfileBlock(draft) === "", "SP-6: بصمة draft لا تُحقن إطلاقاً");
    assert(
      approvedProfileBlock(approved).includes("عبايات"),
      "SP-7: بصمة approved تُحقن بمحتواها"
    );
    assert(approvedProfileBlock(null) === "", "SP-8: بلا بصمة = بلا حقن");

    // العزل بالقراءة.
    const readLog = [];
    await getProfile({ DB: profileDb(readLog, { row: approvedRow }) }, { merchantId: "m_2" });
    assert(
      readLog.length === 1 && /merchant_id = \?/.test(readLog[0].sql) && readLog[0].args[0] === "m_2",
      "SP-9: قراءة البصمة مشروطة بـmerchant_id"
    );

    // الاعتماد يكتب على صف التاجر نفسه فقط، ونسخة التاجر المعدّلة تمرّ بالتطبيع.
    const approveLog = [];
    const approvedOut = await approveProfile(
      { DB: profileDb(approveLog, { row: draftRow }) },
      { merchantId: "m_3", profile: { categories: ["عطور"], audience: "ي", forbidden: [] } }
    );
    assert(
      approvedOut.status === "approved" &&
        approveLog.some((q) => /UPDATE store_profiles/.test(q.sql) && /merchant_id = \?/.test(q.sql)),
      "SP-10: approveProfile يحدّث صف التاجر وحده بحالة approved"
    );
    assert(
      Array.isArray(approvedOut.profile.toneNotes) && approvedOut.profile.vocabulary.length === 0,
      "SP-11: بصمة العميل تمرّ بالتطبيع — لا نثق بشكل ما يرسله"
    );

    // ③ السلوك القديم محفوظ حرفياً بلا بصمة: نفس البرومبت بالضبط.
    const baseArgs = { recent: [], keywords: ["عباية"], existingDescription: "", visionNotes: null, styleExamples: [] };
    const without = buildSeoSystem({ ...baseArgs });
    const withEmpty = buildSeoSystem({ ...baseArgs, profileBlock: "" });
    const withBlock = buildSeoSystem({ ...baseArgs, profileBlock: approvedProfileBlock(approved) });
    assert(without === withEmpty, "SP-12: بلا بصمة، البرومبت مطابق حرفياً للسلوك السابق");
    assert(
      withBlock.length > without.length && withBlock.includes("بصمة هذا المتجر"),
      "SP-13: مع بصمة معتمَدة، الكتلة تُحقن بالـsystem prompt"
    );

    // المرساة: نفس النص حرفياً لكل منتج — لو تغيّر بين استدعاءين انهار الغرض.
    assert(
      profileToPromptBlock(approved.profile) === profileToPromptBlock(approved.profile),
      "SP-14: كتلة البصمة ثابتة (مرساة) لا تتغيّر بين الاستدعاءات"
    );
    assert(
      profileToPromptBlock(normalizeProfile({})) === "",
      "SP-15: بصمة فارغة ترجّع كتلة فارغة لا كتلة هيكلية بلا محتوى"
    );

    // نافذة recentCopy مثبّتة على ٥ (الخطة §٥) — تُقرأ من نص copy.js نفسه.
    const { readFileSync } = await import("node:fs");
    const copySrc = readFileSync(new URL("../functions/api/copy.js", import.meta.url), "utf8");
    assert(
      /RECENT_OPENINGS_WINDOW\s*=\s*5/.test(copySrc) &&
        /recentCopy\(env,\s*merchantId,\s*RECENT_OPENINGS_WINDOW\)/.test(copySrc),
      "SP-16: نافذة recentCopy مثبّتة على ٥ فلا تنجرف عبر دفعة كبيرة"
    );
    // المصادقة التي أُضيفت لإغلاق ثغرات سابقة لم تُنقض بحقن البصمة.
    assert(
      /requireCompletedAccount\(request, env, body\.storeId\)/.test(copySrc),
      "SP-17: copy.js لا يزال يفرض requireCompletedAccount — الحقن ما نقض المصادقة"
    );
  }

  // ── واجهة "منتجاتي": نقطة قراءة الكتالوج + تدفق البطاقة بلا كتابة يدوية ───
  {
    const { readFileSync } = await import("node:fs");
    const listSrc = readFileSync(
      new URL("../functions/api/store/catalog/list.js", import.meta.url),
      "utf8"
    );
    const dashSrc = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");

    assert(
      /requireCompletedAccount\(request, env, body\.storeId\)/.test(listSrc),
      "CATUI-1: /api/store/catalog/list يتطلب حساباً مكتملاً — لا قراءة كتالوج بجلسة ناقصة"
    );
    assert(
      /checkRateLimit\(env, clientIp\(request\), "catalog_list"/.test(listSrc),
      "CATUI-2: نقطة القائمة تحت سقف معدل"
    );
    // العزل: merchantId يجي من الجلسة ويُمرَّر لطبقة الخدمة — لا معرّف من العميل.
    assert(
      /listCatalog\(env, \{ merchantId/.test(listSrc) &&
        !/merchantId:\s*body\./.test(listSrc),
      "CATUI-3: العزل عبر merchantId من الجلسة لا من جسم الطلب"
    );
    assert(
      !/\bDB\b|db\.prepare|SELECT /.test(listSrc),
      "CATUI-4: النقطة لا تلمس D1 مباشرة — كل استعلام يمرّ بـservices/catalog.js"
    );
    assert(
      // النية: صفر نداء على سلة. (اسم العمود salla_product_id قراءةٌ من D1
      // لا نداء شبكة، فيُستثنى صراحةً بدل توسيع الحظر على كلمة "salla".)
      /listProducts|integrations\/salla|sallaFetch|fetch\(/i.test(
        listSrc.replace(/salla_product_id/g, "")
      ) === false,
      "CATUI-5: التصفّح صفر طلبات على سلة — لا يُستهلك حد المتجر"
    );

    // الواجهة: تبويب منتجاتي موجود، والبطاقة تعبّي وتولّد بلا إدخال يدوي.
    assert(
      /switchTab\('catalog'\)/.test(dashSrc) && /id="sectionCatalog"/.test(dashSrc),
      "CATUI-6: تبويب «منتجاتي» وقسمه موجودان بلوحة التاجر"
    );
    const useFn = dashSrc.slice(dashSrc.indexOf("function useCatalogItem"));
    assert(
      /pName'\)\.value = it\.name/.test(useFn) &&
        /pImageUrl'\)\.value = it\.imageUrl/.test(useFn) &&
        /pExistingDescription'\)\.value = it\.currentDescription/.test(useFn) &&
        /generateCopy\(\);/.test(useFn.slice(0, 1400)),
      "CATUI-7: الضغط على بطاقة يعبّي الحقول (اسم/صورة/وصف حالي) ويشغّل التوليد فوراً"
    );
    assert(
      /catalogEmpty[\s\S]{0,400}ما سحبنا منتجاتك بعد/.test(dashSrc),
      "CATUI-8: حالة فارغة صريحة توجّه للسحب"
    );
    // pImageUrl خرج من <details> — لم يعد حقلاً يدوياً مخفياً.
    const detailsBlocks = dashSrc.match(/<details[\s\S]*?<\/details>/g) || [];
    assert(
      detailsBlocks.every((b) => !b.includes('id="pImageUrl"')),
      "CATUI-9: حقل الصورة ظاهر بالمسار الأساسي لا مخفياً داخل <details>"
    );
    assert(
      !/تحسين وصف موجود بدل كتابة من الصفر/.test(dashSrc),
      "CATUI-10: العنوان المضلّل «تحسين وصف موجود» أُزيل"
    );
    // المسار اليدوي باقٍ: الحقول قابلة للكتابة وgenerateCopy تقرأ من الحقول.
    assert(
      /id="pName"[^>]*type="text"/.test(dashSrc) &&
        /const name = document\.getElementById\('pName'\)\.value\.trim\(\)/.test(dashSrc),
      "CATUI-11: المسار اليدوي (كتابة الاسم بلا اختيار منتج) لم يُحذف"
    );
    // تهريب HTML إلزامي على كل محتوى سلة داخل البطاقة.
    const cardFn = dashSrc.slice(
      dashSrc.indexOf("function catalogCard"),
      dashSrc.indexOf("function useCatalogItem")
    );
    const interpolations = cardFn.match(/\$\{[^}]*\}/g) || [];
    assert(
      interpolations.length > 0 &&
        // المسموح بلا escHtml: قِطَع HTML مبنيّة داخلياً (img/badge) وأعلام
        // ثابتة لا تحمل نصاً من سلة. أي شيء غير ذلك لازم يمرّ بـescHtml.
        interpolations.every((s) =>
          /escHtml\(/.test(s) || /^\$\{(img|badge|it\.imageUrl \? 'hidden' : '')\}$/.test(s)
        ),
      "CATUI-12: كل محتوى سلة داخل بطاقة المنتج يمرّ بـescHtml — ثغرة XSS لا تُعاد"
    );
    assert(
      /onerror=/.test(cardFn) && /img-fallback/.test(cardFn),
      "CATUI-13: صورة سلة المحمية تسقط لبديل بدل أيقونة مكسورة"
    );
  }

  // ── تحليل الصورة: "وفق الصورة" لا اختلاق (بلاغ 2026-09-07) ────────────────
  {
    const { readFileSync } = await import("node:fs");
    const { VISION_PROMPT, buildSeoSystem } = await import("../functions/api/copy.js");
    const copySrc = readFileSync(new URL("../functions/api/copy.js", import.meta.url), "utf8");

    assert(
      /صف ما تراه في الصورة فقط/.test(VISION_PROMPT) &&
        /ممنوع الاستنتاج أو الافتراض/.test(VISION_PROMPT),
      "VIS-1: توجيه الرؤية يحصر المخرَج بما هو مرئي ويمنع الاستنتاج"
    );
    assert(
      /عند أي شك لا تذكر الخامة إطلاقاً/.test(VISION_PROMPT),
      "VIS-2: الخامة لا تُذكر عند الشك — لا تخمين يُقدَّم كحقيقة"
    );
    assert(
      !/اللون، الخامة، الشكل العام/.test(copySrc),
      "VIS-3: التوجيه القديم الذي يطلب الخامة صراحةً لم يعد موجوداً"
    );
    assert(
      /فاسكت عنه تماماً/.test(VISION_PROMPT),
      "VIS-4: الغموض يُسكت عنه، لا يُخمَّن ولا يُعتذر عنه"
    );
    assert(
      /ممنوع أي لغة تسويقية/.test(VISION_PROMPT) && !/مهمة للتسويق/.test(VISION_PROMPT),
      "VIS-5: مرحلة الرؤية وصف محايد — صفر لغة تسويقية"
    );
    assert(
      /٣ إلى ٥ جمل/.test(VISION_PROMPT) && /بلا حشو/.test(VISION_PROMPT),
      "VIS-6: سقف موسّع للتفاصيل المرئية مع منع الحشو"
    );
    assert(
      /askVisionAI\(\{ env, imageUrl, prompt: visionPrompt \}\)\.catch\(\(\) => null\)/.test(copySrc) &&
        /const visionPrompt = visionPromptFromTaxonomy\(taxonomyBlock\)/.test(copySrc),
      "VIS-7: التوجيه مصدر واحد، وفشل الرؤية ما زال لا يكسر المسار"
    );

    // حصانة المخرَج بالمرحلة التالية.
    const withVision = buildSeoSystem({
      recent: [], keywords: ["عباية"], existingDescription: "", styleExamples: [],
      visionNotes: "عباية سوداء بقصة مستقيمة."
    });
    assert(
      /ليست مواصفات مؤكدة/.test(withVision) && /ما لم يُذكر = غير معروف/.test(withVision),
      "VIS-8: البرومبت الرئيسي يعامل ملاحظات الرؤية كمرئيات لا كمواصفات"
    );
    assert(
      /ممنوع بناء أي ادعاء جودة أو خامة/.test(withVision),
      "VIS-9: لا ادعاء خامة/جودة مبني على وصف الرؤية"
    );
    assert(
      !/ملاحظات من تحليل صورة المنتج الفعلية \(استخدميها/.test(copySrc),
      "VIS-10: الصياغة القديمة المتساهلة لكتلة الرؤية أُزيلت"
    );

    // ── الإلزام مقابل المنع (بلاغ 2026-09-08) ──────────────────────────────
    // منع الاختلاق وحده جعل النموذج يتجاهل ملاحظات الصورة كلياً فيخرج وصف
    // عام بلا لون ولا قصّة. هذي الاختبارات تثبّت الطرف الآخر من التوازن.
    assert(
      /اذكر صراحةً/.test(VISION_PROMPT) &&
        /اللون/.test(VISION_PROMPT) &&
        /القصّة\/السيلويت/.test(VISION_PROMPT),
      "VIS-11: مرحلة الرؤية تُلزم بإخراج اللون والقصّة لا مجرد منع التخمين"
    );
    assert(
      /اذكري صراحةً/.test(withVision) && /نوع القصّة\/السيلويت/.test(withVision),
      "VIS-12: كتلة الحقن تُلزم بذكر اللون والقصّة صراحةً"
    );
    assert(
      /اقتراح استخدام معقول/.test(withVision) && /مشتقاً مما يُرى فقط/.test(withVision),
      "VIS-13: اقتراح الاستخدام مطلوب ومشتق من المرئيات وحدها"
    );
    assert(
      /= نقص بالوصف، لا احتياط/.test(withVision),
      "VIS-14: الصمت عن تفصيل مرئي يُعدّ نقصاً لا احتياطاً"
    );
    assert(
      /الوصف والنبذة يجب أن يذكرا صراحةً/.test(withVision) &&
        !/الوصف والنبذة يجب أن يذكرا صراحةً/.test(
          buildSeoSystem({
            recent: [], keywords: ["عباية"], existingDescription: "",
            styleExamples: [], visionNotes: ""
          })
        ),
      "VIS-15: إلزام المخرَج النهائي يُحقن فقط حين تتوفر ملاحظات صورة"
    );
  }

  // ── وجهة النشر تُضبط آلياً من المنتج المختار (صفر كتابة) ──────────────
  {
    console.log("\n--- Publish target auto-fill ---");
    const { readFileSync } = await import("node:fs");
    const listSrc = readFileSync(
      new URL("../functions/api/store/catalog/list.js", import.meta.url), "utf8"
    );
    const dashSrc = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");

    assert(
      /productId:\s*r\.salla_product_id\s*\|\|\s*null/.test(listSrc),
      "PUB-1: /catalog/list يُرجع معرّف المنتج بسلة لكل عنصر"
    );
    assert(
      /setPublishTarget\(it\.productId, it\.name\)/.test(dashSrc),
      "PUB-2: اختيار منتج من الكتالوج يضبط وجهة النشر آلياً"
    );
    assert(
      /<select id="publishProduct"/.test(dashSrc) && !/id="publishProduct"[^>]*(disabled|readonly)/.test(dashSrc),
      "PUB-3: المسار اليدوي باقٍ — حقل النشر موجود وقابل للتعديل"
    );
    assert(
      /onchange="onPublishProductChange\(\)"/.test(dashSrc) && /function onPublishProductChange\(/.test(dashSrc),
      "PUB-4: التغيير اليدوي للقائمة يحدّث الوجهة المعروضة"
    );
    assert(
      /'سينشر على: <span class="font-black">' \+ escHtml\(/.test(dashSrc),
      "PUB-5: اسم المنتج يُعرض مهرَّباً بـescHtml (لا حقن من سلة)"
    );
    assert(
      /اختر المنتج أولاً من تبويب «منتجاتي»/.test(dashSrc)
        && /ولّد الوصف أولاً قبل النشر/.test(dashSrc),
      "PUB-6: لا فشل صامت — رسالة عربية عند غياب المنتج أو الوصف"
    );
    assert(
      !/const productId = document\.getElementById\('publishProduct'\)\.value;\s*\n\s*if \(!productId \|\| !lastCopy\) return;/.test(dashSrc),
      "PUB-7: العودة الصامتة القديمة بـpublishToSalla أُزيلت"
    );
  }

  // ── APPROVE-*: راجع واعتمد بعد التوليد (لوحة التاجر) ───────────────
  {
    const { readFileSync } = await import("node:fs");
    const dashSrc = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");

    assert(
      /راجع الوصف — عدّله إن حبيت، ثم اعتمد/.test(dashSrc),
      "APPROVE-1: عنوان المراجعة صريح فوق الوصف المولَّد"
    );
    assert(
      /id="publishBtn"[\s\S]{0,400}اعتمد وانشر على سلة/.test(dashSrc)
        && /id="regenBtn"[\s\S]{0,400}أعد التوليد/.test(dashSrc),
      "APPROVE-2: الزران متجاوران — «اعتمد وانشر» و«أعد التوليد»"
    );
    assert(
      /function regenerateCopy\(\)[\s\S]{0,300}generateCopy\(\);/.test(dashSrc)
        && /onclick="publishToSalla\(\)"/.test(dashSrc),
      "APPROVE-3: الزران يستدعيان الدالتين الموجودتين بلا إعادة كتابة"
    );
    assert(
      /let publishing = false;/.test(dashSrc)
        && /if \(publishing\) return;/.test(dashSrc)
        && /btnText\.innerText = 'جاري النشر…'/.test(dashSrc),
      "APPROVE-4: منع النشر المزدوج — علم قبل أي await + تعطيل الزر"
    );
    assert(
      /publishing = false;[\s\S]{0,200}btn\.disabled = false;/.test(dashSrc),
      "APPROVE-5: الزر يعود قابلاً للضغط بعد انتهاء الطلب"
    );
    assert(
      /'تم النشر على سلة ✅'/.test(dashSrc) && /bg-green-50/.test(dashSrc),
      "APPROVE-6: حالة نجاح خضراء صريحة"
    );
    assert(
      /fb\.innerHTML = 'تم النشر على سلة ✅'[\s\S]{0,200}escHtml\(t\.name\)/.test(dashSrc),
      "APPROVE-7: اسم المنتج برسالة النجاح مهرَّب بـescHtml"
    );
    assert(
      !/https:\/\/[^"'\s]*\/p\d|productUrl|store_url/.test(dashSrc),
      "APPROVE-8: لا رابط منتج مخترع — البيانات لا تتضمن دومين المتجر"
    );
  }

  // ── كتيب مصطلحات المنتجات (مفردات محكومة حسب الفئة) ──────────────────
  {
    const { taxonomyForCategory, COVERED_CATEGORIES } = await import("../functions/_lib/ai/productTaxonomy.js");
    const { VISION_PROMPT, visionPromptFor, buildSeoSystem } = await import("../functions/api/copy.js");

    const dresses = taxonomyForCategory("فساتين");
    assert(
      COVERED_CATEGORIES.includes("فساتين") && dresses.length > 0,
      "TAX-1: فئة الفساتين مغطاة بكتيب مصطلحات"
    );
    assert(
      ["قصّة A", "ماكسي", "ميدي", "ميني", "قفطان", "بذيل حورية", "بلوزون"].every((t) => dresses.includes(t)),
      "TAX-2: مصطلحات القصّة/السيلويت موجودة بالنص"
    );
    assert(
      ["دائرية", "V", "قارب", "مربعة", "واقفة", "حمالات", "مكشوفة الكتفين"].every((t) => dresses.includes(t)),
      "TAX-3: مصطلحات الياقة موجودة بالنص"
    );
    assert(
      ["ثلاثة أرباع", "بلا أكمام", "منفوخة", "فراشة", "ضيّقة"].every((t) => dresses.includes(t)),
      "TAX-4: مصطلحات الأكمام موجودة بالنص"
    );
    assert(
      ["حزام", "كسرات", "طبقات", "شق جانبي", "أزرار أمامية", "تطريز ظاهر", "منقّطة", "مخططة"].every((t) => dresses.includes(t)),
      "TAX-5: التفاصيل المرئية والطبعة موجودة بالنص"
    );
    assert(
      ["سهرات", "مناسبات", "يومي", "عمل", "صيفي", "شتوي"].every((t) => dresses.includes(t)),
      "TAX-6: الاستخدام المقترح موجود بالنص"
    );

    // الكتيب مفردات وصف — لا خامات ولا أحكام جودة تتسلل من الباب الخلفي.
    assert(
      !/(فاخر|أنيق|عالي الجودة|جودة عالية|مريح|شيفون|كريب|ساتان|قطن|حرير)/.test(dresses),
      "TAX-7: الكتيب بلا خامات ولا أحكام جودة — تسمية فقط"
    );

    // فئة غير مغطاة أو غائبة ⇒ التوجيه القديم حرفياً (نمط SP-12).
    assert(
      taxonomyForCategory("عطور") === "" && taxonomyForCategory("") === "" &&
        taxonomyForCategory(undefined) === "" && taxonomyForCategory(null) === "",
      "TAX-8: فئة غير مغطاة أو غائبة ترجّع كتيباً فارغاً لا كتيباً مخترعاً"
    );
    assert(
      visionPromptFor("عطور") === VISION_PROMPT && visionPromptFor("") === VISION_PROMPT &&
        visionPromptFor(undefined) === VISION_PROMPT,
      "TAX-9: بلا كتيب، توجيه الرؤية مطابق حرفياً للسلوك السابق"
    );

    const withTax = visionPromptFor("فساتين");
    assert(
      withTax.startsWith(VISION_PROMPT) && withTax.includes(dresses),
      "TAX-10: الكتيب يُحقن فوق التوجيه القديم بلا استبداله"
    );
    assert(
      /استخدم المصطلحات التالية حصراً/.test(withTax) && /ولا تخترع بديلاً/.test(withTax),
      "TAX-11: الحقن يحصر التسمية بالمعجم ويمنع اختراع بديل"
    );
    // الكتيب لا ينقض منع الاختلاق — قواعد VIS ما زالت بالنص المحقون.
    assert(
      /ممنوع الاستنتاج أو الافتراض/.test(withTax) && /عند أي شك لا تذكر الخامة إطلاقاً/.test(withTax),
      "TAX-12: منع الاختلاق باقٍ حرفياً بعد الحقن"
    );
    // مرادفات الفئة كما يكتبها التاجر فعلاً.
    assert(
      taxonomyForCategory("الفساتين") === dresses && taxonomyForCategory("ازياء نسائيه") === dresses &&
        taxonomyForCategory("Dresses") === dresses,
      "TAX-13: مرادفات الفئة تُطبَّع (تشكيل/همزة/تاء مربوطة/لاتيني)"
    );

    // إلزام الاتساق بالوصف النهائي — يُحقن فقط مع رؤية + كتيب.
    const seoArgs = { recent: [], keywords: ["فستان"], existingDescription: "", styleExamples: [] };
    const seoWithBoth = buildSeoSystem({ ...seoArgs, visionNotes: "فستان ماكسي بقصّة A.", taxonomyBlock: dresses });
    assert(
      /التزمي بنفس مصطلحات ملاحظات الصورة حرفياً/.test(seoWithBoth) && /لا مرادفات/.test(seoWithBoth),
      "TAX-14: الوصف النهائي مُلزَم بنفس المصطلحات لا بمرادفاتها"
    );
    const seoNoTax = buildSeoSystem({ ...seoArgs, visionNotes: "فستان ماكسي بقصّة A." });
    assert(
      seoNoTax === buildSeoSystem({ ...seoArgs, visionNotes: "فستان ماكسي بقصّة A.", taxonomyBlock: "" }) &&
        !/التزمي بنفس مصطلحات/.test(seoNoTax),
      "TAX-15: بلا كتيب، البرومبت الرئيسي مطابق حرفياً للسلوك السابق"
    );
    assert(
      !/التزمي بنفس مصطلحات/.test(buildSeoSystem({ ...seoArgs, visionNotes: "", taxonomyBlock: dresses })),
      "TAX-16: بلا ملاحظات صورة لا يُحقن إلزام الاتساق"
    );
    // حجم البرومبت تكلفة بكل استدعاء.
    assert(dresses.length < 700, `TAX-17: الكتيب مختصر (${dresses.length} حرفاً)`);

    // ── الفئات المضافة من قاموس المصطلحات السعودي (2026-09-08) ──
    const abayas = taxonomyForCategory("عبايات");
    const jewelry = taxonomyForCategory("مجوهرات");
    const apparel = taxonomyForCategory("ملابس");
    assert(
      [abayas, jewelry, apparel].every((t) => t.length > 0) &&
        ["عبايات", "مجوهرات", "ملابس"].every((c) => COVERED_CATEGORIES.includes(c)),
      "TAX-18: عبايات/مجوهرات/ملابس مغطاة بكتيب مصطلحات"
    );
    assert(
      ["كلوش", "بشت", "فراشة", "مطرزة", "مفتوحة"].every((t) => abayas.includes(t)),
      "TAX-19: مصطلحات العبايات من القاموس موجودة"
    );
    assert(
      ["تشوكر", "سوليتير", "دبلة", "خلخال", "أقراط متدلية", "مرصّع"].every((t) => jewelry.includes(t)),
      "TAX-20: مصطلحات المجوهرات من القاموس موجودة"
    );
    assert(
      ["أوفر سايز", "بوكسي", "بليزر", "بليسيه", "واسع الساق"].every((t) => apparel.includes(t)),
      "TAX-21: مصطلحات الملابس من القاموس موجودة"
    );
    // المجوهرات: الصورة تُظهر لون المعدن لا مادته — لا ادعاء "ذهب" أو "ألماس".
    assert(
      /ذهبي أصفر/.test(jewelry) &&
        !/ألماس|زركون|استرليني/.test(
          jewelry.split("\n").filter((l) => l.startsWith("- ")).join("\n")
        ) &&
        /لا تُسمّي معدناً ولا حجراً بيقين/.test(jewelry),
      "TAX-22: معجم المجوهرات يسمّي اللون لا المادة (لا ادعاء ذهب/ألماس)"
    );
    // نفس قاعدة TAX-7 مطبَّقة على كل الفئات الجديدة: لا خامات ولا أحكام جودة.
    assert(
      [abayas, jewelry, apparel].every(
        (t) => !/(فاخر|أنيق|عالي الجودة|جودة عالية|مريح|شيفون|كريب|ساتان|قطن|حرير|مخمل|دانتيل|كتان|دنيم|تريكو|كشمير)/.test(t)
      ),
      "TAX-23: الفئات الجديدة بلا خامات ولا أحكام جودة"
    );
    assert(
      [abayas, jewelry, apparel].every((t) => t.length < 700),
      "TAX-24: كل كتيب فئة مختصر (<700 حرف)"
    );
    assert(
      taxonomyForCategory("عباية") === abayas && taxonomyForCategory("اكسسوارات") === jewelry &&
        taxonomyForCategory("Jewelry") === jewelry && taxonomyForCategory("ازياء") === apparel,
      "TAX-25: مرادفات الفئات الجديدة تُطبَّع"
    );
    // لا تلوّث متبادل: معجم كل فئة مستقل.
    assert(
      !abayas.includes("تشوكر") && !jewelry.includes("قصّة A") && !apparel.includes("بذيل حورية"),
      "TAX-26: لا تسرّب مفردات بين الفئات"
    );

    // ── احتياط اسم المنتج حين تكون فئة المتجر خاطئة (رُصد بفيديو 2026-09-08:
    //    منتج "فستان" مصنَّف تحت "البلايز" ⇒ سقط الكتيب كله بصمت) ──
    const { taxonomyForProduct } = await import("../functions/_lib/ai/productTaxonomy.js");
    assert(
      taxonomyForProduct({ category: "البلايز", name: "فستان" }) === dresses &&
        taxonomyForProduct({ category: "", name: "عباية كلوش" }) === abayas,
      "TAX-27: فئة غير مطابقة تسقط لاسم المنتج بدل إسقاط الكتيب"
    );
    assert(
      taxonomyForProduct({ category: "فساتين", name: "قلادة ذهب" }) === dresses,
      "TAX-28: الفئة أسبق دائماً — الاسم مصدر احتياطي لا بديل"
    );
    // البحث الجزئي بالاسم هو ما أُغلقت القائمة لمنعه — الكلمة الأولى فقط.
    assert(
      taxonomyForProduct({ category: "شنط", name: "شنطة تناسب الفساتين" }) === "" &&
        taxonomyForProduct({ category: "", name: "حزام يناسب الفساتين" }) === "",
      "TAX-29: اسم يذكر فئة أخرى عرضاً لا يحقن معجمها"
    );
    assert(
      taxonomyForProduct({ category: "", name: "" }) === "" &&
        taxonomyForProduct({}) === "" && taxonomyForProduct() === "",
      "TAX-30: غياب الفئة والاسم يرجّع كتيباً فارغاً لا يرمي"
    );
    // مسار الرؤية يستهلك الكتيب نفسه أياً كان مصدره.
    const { visionPromptFromTaxonomy } = await import("../functions/api/copy.js");
    assert(
      visionPromptFromTaxonomy("") === VISION_PROMPT &&
        visionPromptFromTaxonomy(dresses) === visionPromptFor("فساتين"),
      "TAX-31: بناء توجيه الرؤية واحد سواء جاء الكتيب من الفئة أو الاسم"
    );
  }

  // ── اختيار نموذج الرؤية والوصف (تبديل 2026-09-08) ────────────────────
  {
    const { askVisionAI, VISION_MODEL, VISION_FALLBACK_MODEL, COPY_MODEL, TEXT_MODEL } =
      await import("../functions/_lib/ai/gateway.js");

    assert(
      VISION_MODEL === "@cf/meta/llama-4-scout-17b-16e-instruct" &&
        COPY_MODEL === "@cf/meta/llama-4-scout-17b-16e-instruct",
      "MDL-1: الرؤية والوصف على نموذج يدعم العربية رسمياً"
    );
    assert(
      VISION_FALLBACK_MODEL === "@cf/meta/llama-3.2-11b-vision-instruct" &&
        VISION_MODEL !== VISION_FALLBACK_MODEL,
      "MDL-2: النموذج السابق يبقى احتياطياً لا أساسياً"
    );
    assert(
      TEXT_MODEL === "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      "MDL-3: نموذج المحادثة/الشخصية لم يُمَس"
    );

    const img = new Uint8Array([137, 80, 78, 71]).buffer;

    // المسار الأساسي: صيغة رسائل متعددة الأجزاء + data URI.
    let seen = null;
    const okEnv = {
      AI: {
        run: async (model, input) => {
          seen = { model, input };
          return { response: "فستان ماكسي أسود بقصّة A." };
        }
      }
    };
    const out = await askVisionAI({ env: okEnv, imageBuffer: img, prompt: "صف" });
    const part = seen.input.messages?.[0]?.content;
    assert(
      out === "فستان ماكسي أسود بقصّة A." && seen.model === VISION_MODEL &&
        Array.isArray(part) && part[0].type === "text" && part[0].text === "صف" &&
        part[1].type === "image_url" && /^data:image\/jpeg;base64,/.test(part[1].image_url.url),
      "MDL-4: الرؤية تستدعي سكاوت بصيغة أجزاء + data URI"
    );

    // فشل الأساسي (نموذج غير متاح أو صيغة تغيّرت) لا يُسقط الميزة.
    const calls = [];
    const failEnv = {
      AI: {
        run: async (model, input) => {
          calls.push(model);
          if (model === VISION_MODEL) throw new Error("model unavailable");
          return { response: "وصف من الاحتياطي" };
        }
      }
    };
    const fb = await askVisionAI({ env: failEnv, imageBuffer: img, prompt: "صف" });
    assert(
      fb === "وصف من الاحتياطي" && calls[0] === VISION_MODEL && calls[1] === VISION_FALLBACK_MODEL,
      "MDL-5: فشل الأساسي يسقط للاحتياطي بدل إسقاط الميزة"
    );

    // مخرج فارغ من الأساسي يُعامَل فشلاً — لا وصف فارغ يمر للتاجر.
    const emptyEnv = {
      AI: {
        run: async (model) =>
          model === VISION_MODEL ? { response: "   " } : { response: "احتياطي" }
      }
    };
    assert(
      (await askVisionAI({ env: emptyEnv, imageBuffer: img, prompt: "صف" })) === "احتياطي",
      "MDL-6: مخرج فارغ من الأساسي يسقط للاحتياطي"
    );

    // صيغة متوافقة مع OpenAI تُقرأ أيضاً (لا اعتماد على شكل واحد).
    const oaEnv = {
      AI: { run: async () => ({ choices: [{ message: { content: "وصف OpenAI-style" } }] }) }
    };
    assert(
      (await askVisionAI({ env: oaEnv, imageBuffer: img, prompt: "صف" })) === "وصف OpenAI-style",
      "MDL-7: قارئ المخرج يفهم صيغة choices[] كما يفهم response"
    );

    // صورة كبيرة: التحويل لـbase64 لا ينفجر بتجاوز مكدس الوسائط.
    const bigEnv = { AI: { run: async () => ({ response: "ok" }) } };
    const big = new Uint8Array(300000).buffer;
    assert(
      (await askVisionAI({ env: bigEnv, imageBuffer: big, prompt: "صف" })) === "ok",
      "MDL-8: صورة ٣٠٠ كيلوبايت تُرمَّز بلا تجاوز مكدس"
    );
  }

  // ── المرحلة ١.٧ (COMPLETION_PATH) — P18 · P23 · P26 · console.error ─────
  {
    const { readFileSync } = await import("node:fs");
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const { timingSafeEqualStr } = await import("../functions/_lib/core/crypto.js");

    assert(timingSafeEqualStr("abc", "abc") === true && timingSafeEqualStr("abc", "abd") === false
      && timingSafeEqualStr("abc", "abcd") === false && timingSafeEqualStr(undefined, "") === true,
      "P26-1: timingSafeEqualStr يطابق/يرفض صح ويتحمل undefined");
    for (const f of ["bulk_process", "healthcheck", "reminders"]) {
      const src = read(`../functions/api/cron/${f}.js`);
      assert(!src.includes("provided !== env.CRON_SECRET") && src.includes("timingSafeEqualStr(provided, env.CRON_SECRET)"),
        `P26-2: cron/${f} يقارن CRON_SECRET بمقارنة ثابتة الزمن`);
    }

    const rem = read("../functions/api/cron/reminders.js");
    assert(/SELECT id, ticket_code,/.test(rem) && rem.includes("booking.ticket_code ||"),
      "P18-1: التذكير يقرأ عمود ticket_code (المصدر الوحيد) بدل إعادة حسابه");
    assert(!rem.includes("966500000000") && rem.includes("if (employeePhone)"),
      "P49/P18-2: لا رقم موظف مفبرك — يُتخطى التذكير عند غياب الرقم");

    const chat = read("../functions/api/chat.js");
    assert(!chat.includes("body.debug"), "P23: علم debug لا يُقرأ من جسم الطلب — من البيئة فقط");

    // كل console.error خام هاجر إلى logError (errorLog.js هو السنك الوحيد المسموح).
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = new URL("../functions", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".js") && !p.endsWith("errorLog.js") && readFileSync(p, "utf8").includes("console.error(")) offenders.push(name);
      }
    };
    walk(root);
    assert(offenders.length === 0, `LOG-1: صفر console.error خام خارج errorLog.js (المخالف: ${offenders.join(", ") || "لا شيء"})`);
  }

  // ── المرحلة ٢ (docs/COMPLETION_PATH.md) — الجملة عبر بوابة المراجعة ─────
  {
    const { readFileSync } = await import("node:fs");
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

    // BULK-1 — الفصل: مسار التوليد لا يستورد سلة إطلاقاً، وينشر حصراً عبر publishApproved.
    const cron = read("../functions/api/cron/bulk_process.js");
    assert(
      !/integrations\/salla\.js/.test(cron) && !/updateProductBySku/.test(cron),
      "BULK-1: cron/bulk_process لا يستورد سلة ولا updateProductBySku — التوليد صفر كتابة على سلة"
    );
    assert(
      /enqueue\(env, \{ merchantId: item\.merchant_id, kind: "description"/.test(cron) && /publishApproved\(env, row\)/.test(cron),
      "BULK-2: التوليد يدخل review_queue بنوع description، والنشر يمرّ بـpublishApproved فقط"
    );
    assert(
      /claimNextPublishMerchant/.test(cron) && /stoppedByRateLimit = true/.test(cron) && /SALLA_DELAY_MS = 1100/.test(cron),
      "BULK-3: النشر متجر واحد لكل تِك، فاصل ≥ ١.١ث، توقف عند ٤٢٩"
    );

    // BULK-4 — publishApproved: وصف معتمد يُكتب بالـSKU، و٤٢٩ يرفع retryAfter، و٤٢٢ يسقط للوصف وحده.
    const pubSrc = read("../functions/_lib/services/publishApproved.js");
    assert(
      /row\?\.kind === "description"/.test(pubSrc) && /status === 429/.test(pubSrc) && /status === 422 && body\.metadata/.test(pubSrc) && /markPublished/.test(pubSrc),
      "BULK-4: publishApproved يعالج description بالـSKU مع ٤٢٩→retryAfter و٤٢٢→الوصف وحده ويعلّم الكتالوج"
    );

    // BULK-5 — approveMany: كل صف بشرط pending + merchant_id؛ فشل صف لا يوقف الباقي ولا يُخفى.
    const { approveMany, updatePayload, countByState, listByState } = await import("../functions/_lib/services/reviewQueue.js");
    const seen = [];
    const rqDb = {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => {
                if (/UPDATE review_queue\s+SET status = \?/.test(sql)) {
                  seen.push({ id: args[3], mid: args[4] });
                  // الصف ٣ "مُراجَع مسبقاً" — صفر صفوف متأثرة.
                  return args[3] === 3 ? null : { id: args[3], merchant_id: args[4], kind: "description", status: args[0], payload: "{}" };
                }
                if (/SELECT payload FROM review_queue/.test(sql)) {
                  return args[0] === 7 ? { payload: JSON.stringify({ sku: "S1", description: "قديم" }) } : null;
                }
                if (/UPDATE review_queue SET payload/.test(sql)) {
                  return { id: args[1], merchant_id: args[2], kind: "description", payload: args[0], status: "pending" };
                }
                if (/SUM\(status = 'pending'\)/.test(sql)) {
                  return { pending: 2, awaiting_publish: 1, published: 3, publish_failed: 0, rejected: 1 };
                }
                return null;
              },
              all: async () => ({ results: [] }),
              run: async () => ({ meta: {} })
            };
          }
        };
      }
    };
    const many = await approveMany({ DB: rqDb }, { merchantId: "m_a", ids: [1, 3, 5], reviewedBy: "merchant:m_a" });
    assert(
      many.approved.length === 2 && many.failed.length === 1 && many.failed[0].id === 3 && seen.every((s) => s.mid === "m_a" && /UPDATE/.test("UPDATE")),
      "BULK-5: approveMany يعتمد ٢ ويُبلّغ فشل الثالث صراحة، وكل تحديث مقيّد بـmerchant_id"
    );
    assert(
      seen.length === 3 && seen.every((s) => s.mid === "m_a"),
      "BULK-6: صفر تحديث بلا merchant_id — العزل على كل صف بالاعتماد الجماعي"
    );

    // BULK-7 — updatePayload: يدمج فوق الحمولة الحالية بشرط pending؛ غير المعلّق يُرفض ٤٠٤.
    const edited = await updatePayload({ DB: rqDb }, { merchantId: "m_a", id: 7, patch: { description: "جديد" } });
    const editedPayload = JSON.parse(edited.payload);
    assert(
      editedPayload.sku === "S1" && editedPayload.description === "جديد" && typeof editedPayload.editedAt === "string",
      "BULK-7: التحرير السطري يدمج الوصف الجديد فوق الحمولة ويحتفظ بالـSKU"
    );
    let notPending = null;
    try {
      await updatePayload({ DB: rqDb }, { merchantId: "m_a", id: 8, patch: { description: "x" } });
    } catch (e) {
      notPending = e;
    }
    assert(notPending?.status === 404 && notPending?.code === "REVIEW_NOT_PENDING", "BULK-8: تعديل عنصر غير معلّق يُرفض ٤٠٤ بلا كتابة");

    // BULK-9 — العدّادات الصادقة تفرّق "معتمد بانتظار النشر" عن "نُشر".
    const counts = await countByState({ DB: rqDb }, { merchantId: "m_a", kind: "description" });
    assert(
      counts.pending === 2 && counts.awaitingPublish === 1 && counts.published === 3 && counts.rejected === 1,
      "BULK-9: countByState يعيد معلّق/بانتظار النشر/نُشر/مرفوض منفصلة"
    );
    let badState = null;
    try {
      await listByState({ DB: rqDb }, { merchantId: "m_a", kind: "description", state: "1=1 OR" });
    } catch (e) {
      badState = e;
    }
    assert(badState?.status === 400, "BULK-10: حالة غير معروفة تُرفض ٤٠٠ — لا تركيب SQL من مدخل عميل");

    // BULK-11 — التراجع: الأصل يُكتب مرة واحدة ولا يمحوه السحب.
    const catalogSrc = read("../functions/_lib/services/catalog.js");
    assert(
      /original_description = COALESCE\(store_products\.original_description, excluded\.current_description\)/.test(catalogSrc),
      "BULK-11: سحب الكتالوج يحفظ original_description مرة واحدة (COALESCE) — التراجع ممكن بعد نشر هالة"
    );
    const migration = read("../migrations/0022_catalog_original_description.sql");
    assert(/ADD COLUMN original_description/.test(migration) && /ADD COLUMN hala_published_at/.test(migration), "BULK-12: هجرة 0022 تضيف original_description وhala_published_at");

    // BULK-13 — التراجع يرفض ما لم تنشره هالة، ويُرجع الأصل حتى لو كان فارغاً (بلا اختراع نص).
    const decideSrc = read("../functions/api/store/review/decide.js");
    assert(
      /NOTHING_TO_REVERT/.test(decideSrc) && /NOT_IN_CATALOG/.test(decideSrc) && /item\.original_description \|\| ""/.test(decideSrc) && /markReverted/.test(decideSrc),
      "BULK-13: revert مقيّد بما نشرته هالة، ويُرجع الأصل كما هو (حتى الفارغ)"
    );
    assert(
      /requireCompletedAccount\(request, env, body\.storeId\)/.test(decideSrc) && /reviewedBy = `merchant:\$\{merchantId\}`/.test(decideSrc),
      "BULK-14: قرارات التاجر بهوية الجلسة (reviewed_by من الجلسة لا من الجسم)"
    );

    // BULK-15 — الحصة الصادقة: أولوية + تأجيل بدل رفض + إحياء شهري.
    const genSrc = read("../functions/api/store/bulk/generate.js");
    assert(
      /listPriorityCatalog/.test(genSrc) && /DEFERRED_MARKER/.test(genSrc) && /باقتك تغطي/.test(genSrc),
      "BULK-15: التوليد من الكتالوج بأولوية SEO، وما فوق الحصة مؤجَّل بنص صادق"
    );
    assert(/tickReviveDeferred/.test(cron) && /reviveDeferredItems/.test(cron), "BULK-16: الـcron يُحيي المؤجَّل عند تجدّد الحصة بلا فعل من التاجر");
    assert(
      /ORDER BY \(hala_published_at IS NOT NULL\) ASC,\s*\(COALESCE\(LENGTH\(current_description\), 0\) = 0\) DESC/.test(catalogSrc),
      "BULK-17: أولوية الحصة — بلا وصف أولاً، ثم القصير، وما نشرته هالة آخراً"
    );

    // BULK-18 — الداشبورد: لا وعد بنشر تلقائي؛ زر توليد من الكتالوج وشاشة مراجعة.
    const dash = read("../dashboard.html");
    assert(
      !/ينشره على سلة تلقائياً/.test(dash) && /لا يُنشر شيء على سلة قبل ما تراجعه وتعتمده/.test(dash) && /\/api\/store\/review\/decide/.test(dash) && /\/api\/store\/bulk\/generate/.test(dash),
      "BULK-18: الداشبورد يعد بالمراجعة لا بالنشر التلقائي، ويصل شاشة المراجعة والتوليد من الكتالوج"
    );
  }

  // ── المرحلة ٣ (docs/COMPLETION_PATH.md) — بوابة "قبل أول تاجر حقيقي" ────
  {
    const { readFileSync } = await import("node:fs");
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const { createSessionToken, verifySessionToken, bumpSessionVersion, currentSessionVersion } = await import("../functions/_lib/core/session.js");
    const { assertTrustedWrite } = await import("../functions/_lib/core/csrf.js");
    const { withApi } = await import("../functions/_lib/core/respond.js");

    // P40 — إبطال الجلسات: نسخة الحساب تُضمَّن بالتوقيع؛ الرفع يقتل كل توكن أقدم.
    const versions = new Map([["m_v", 0]]);
    const kvStore = new Map();
    const vEnv = {
      SESSION_SECRET: "test-secret-12345",
      HALA_CACHE: { get: async (k) => kvStore.get(k) ?? null, put: async (k, v) => { kvStore.set(k, v); }, delete: async () => {} },
      DB: {
        prepare(sql) {
          return {
            bind(...args) {
              return {
                first: async () => {
                  if (/SELECT session_version FROM accounts/.test(sql)) return versions.has(args[0]) ? { session_version: versions.get(args[0]) } : null;
                  if (/UPDATE accounts SET session_version = session_version \+ 1/.test(sql)) {
                    if (!versions.has(args[0])) return null;
                    versions.set(args[0], versions.get(args[0]) + 1);
                    return { session_version: versions.get(args[0]) };
                  }
                  return null;
                },
                run: async () => ({ meta: {} })
              };
            }
          };
        }
      }
    };
    const tokV0 = await createSessionToken(vEnv, "m_v");
    assert((await verifySessionToken(vEnv, tokV0)) === "m_v", "P40-1: توكن بالنسخة الحالية يمرّ");
    await bumpSessionVersion(vEnv, "m_v");
    assert((await verifySessionToken(vEnv, tokV0)) === null, "P40-2: بعد الرفع (خروج/إعادة تعيين/تعطيل) التوكن القديم يموت فوراً");
    const tokV1 = await createSessionToken(vEnv, "m_v");
    assert((await verifySessionToken(vEnv, tokV1)) === "m_v" && tokV1.split(".")[2] === "1", "P40-3: توكن جديد يحمل النسخة ١ ويمرّ");
    // توكن قديم الشكل (٣ أجزاء) = نسخة ٠ فقط
    kvStore.clear(); versions.set("m_legacy", 0);
    const legacyPayload = "m_legacy.9999999999";
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("test-secret-12345"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(legacyPayload)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    assert((await verifySessionToken(vEnv, `${legacyPayload}.${mac}`)) === "m_legacy", "P40-4: توكن ما قبل الهجرة (٣ أجزاء) يمرّ ما دامت النسخة ٠ — لا طرد جماعي بالنشر");
    await bumpSessionVersion(vEnv, "m_legacy");
    assert((await verifySessionToken(vEnv, `${legacyPayload}.${mac}`)) === null, "P40-5: أول رفع يقتل التوكنات القديمة الشكل أيضاً");
    // تاجر بلا صف accounts (سلة Easy-Mode) = نسخة ٠
    kvStore.clear();
    assert((await currentSessionVersion(vEnv, "m_no_account")) === 0, "P40-6: تاجر بلا حساب نسخته ٠ (معرّفه هو اعتماده الوحيد)");
    // فشل D1 وKV معاً = fail closed
    const deadEnv = { SESSION_SECRET: "test-secret-12345", DB: { prepare() { throw new Error("D1 down"); } } };
    assert((await verifySessionToken(deadEnv, tokV1)) === null, "P40-7: تعذّر تأكيد النسخة (D1 وKV) = لا جلسة — fail closed");
    // لا توكن قديم يبقى بعد الخروج: logout يرفع النسخة فعلاً
    const logoutSrc = read("../functions/api/auth/logout.js");
    const resetSrc = read("../functions/api/auth/reset_password.js");
    const accountsSrc = read("../functions/api/admin/accounts.js");
    assert(/bumpSessionVersion\(env, merchantId\)/.test(logoutSrc) && /bumpSessionVersion\(env, owner\.merchant_id\)/.test(resetSrc) && /if \(body\.disabled\) await bumpSessionVersion/.test(accountsSrc),
      "P40-8: الخروج وإعادة التعيين والتعطيل ترفع النسخة (الأحداث الثلاثة بالخطة)");

    // P42 — CSRF: Origin غريب يُرفض، نموذج text/plain يُرفض، نفس الأصل وإطار سلة يمرّان.
    const mk = (headers, body = '{"a":1}') => new Request("https://halah.aura.sa/api/x", { method: "POST", headers, body });
    const throwsCode = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };
    assert(throwsCode(() => assertTrustedWrite(mk({ Origin: "https://evil.example", "Content-Type": "application/json" }), {})) === "CSRF_REJECTED", "P42-1: Origin غريب → CSRF_REJECTED");
    assert(throwsCode(() => assertTrustedWrite(mk({ Origin: "https://halah.aura.sa", "Content-Type": "text/plain" }), {})) === "UNSUPPORTED_MEDIA_TYPE", "P42-2: نموذج enctype=text/plain → 415 حتى من نفس الأصل");
    assert(throwsCode(() => assertTrustedWrite(mk({ Origin: "https://halah.aura.sa", "Content-Type": "application/json" }), {})) === null, "P42-3: نفس الأصل + JSON يمرّ");
    assert(throwsCode(() => assertTrustedWrite(mk({ Origin: "https://s.salla.sa", "Content-Type": "application/json" }), {})) === null, "P42-4: إطار سلة يمرّ");
    assert(throwsCode(() => assertTrustedWrite(mk({ Origin: "https://abc123.hala-ai-os.pages.dev", "Content-Type": "application/json" }), {})) === null, "P42-5: نشرة معاينة تمرّ");
    assert(throwsCode(() => assertTrustedWrite(mk({ "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" }), {})) === "CSRF_REJECTED", "P42-6: Sec-Fetch-Site=cross-site بلا Origin → مرفوض");
    assert(throwsCode(() => assertTrustedWrite(new Request("https://halah.aura.sa/api/x", { method: "POST" }), {})) === null, "P42-7: عميل غير متصفح بلا Origin ولا جسم (cron-worker/curl) يمرّ — لا كوكي ضحية معه");
    assert(throwsCode(() => assertTrustedWrite(new Request("https://halah.aura.sa/api/x", { method: "GET", headers: { Origin: "https://evil.example" } }), {})) === null, "P42-8: GET لا يُفحص (لا تغيير حالة)");
    assert(throwsCode(() => assertTrustedWrite(mk({ Origin: "https://evil-facebook.com", "Content-Type": "application/json" }), { TRUSTED_ORIGINS: "https://partner.example" })) === "CSRF_REJECTED", "P42-9: TRUSTED_ORIGINS لا تفتح ما لم يُدرَج حرفياً");
    // سلوكياً عبر withApi: الرد 403 عربي بلا تنفيذ المعالج
    let handlerRan = false;
    const guarded = withApi(async () => { handlerRan = true; return { ok: true }; });
    const csrfRes = await guarded({ request: mk({ Origin: "https://evil.example", "Content-Type": "application/json" }), env: {}, waitUntil() {} });
    const csrfBody = await csrfRes.json();
    assert(csrfRes.status === 403 && csrfBody.code === "CSRF_REJECTED" && handlerRan === false && /مصدر غير موثوق/.test(csrfBody.error), "P42-10: withApi يرفض قبل تنفيذ المعالج برسالة عربية + requestId");
    // المعالجات الخام (signup/login/logout/me/complete_account) تستدعي الحارس
    for (const f of ["signup", "login", "logout", "me", "complete_account"]) {
      assert(/assertTrustedWrite\(request, env\)/.test(read(`../functions/api/auth/${f}.js`)), `P42-11: auth/${f} يمرّ بحارس CSRF (معالج خام خارج withApi)`);
    }

    // P38 طبقة ٢ — حرق رمز تحقق البريد بعد ٥ محاولات، والعدّ ذرّي قبل المقارنة.
    const verifySrc = read("../functions/api/auth/verify_email.js");
    assert(/UPDATE email_verifications SET attempts = attempts \+ 1/.test(verifySrc) && /RETURNING code_hash, attempts/.test(verifySrc) && /row\.attempts > MAX_ATTEMPTS/.test(verifySrc) && /DELETE FROM email_verifications/.test(verifySrc),
      "P38-L2-1: verify_email يعدّ المحاولة ذرّياً قبل المقارنة ويحرق الرمز بعد ٥");
    const sendSrc = read("../functions/api/auth/send_verification.js");
    assert(/EMAIL_NOT_CONFIGURED/.test(sendSrc) && /emailConfigured\(env\)/.test(sendSrc), "P38-L2-2: بلا مزوّد بريد = 503 صريح، لا ادعاء إرسال");
    const emailMod = await import("../functions/_lib/integrations/email.js");
    assert(emailMod.isConfigured({}) === false && emailMod.isConfigured({ RESEND_API_KEY: "k" }) === false && emailMod.isConfigured({ RESEND_API_KEY: "k", EMAIL_FROM: "x@y" }) === true, "P38-L2-3: محوّل البريد fail-closed بلا السرّين");
    let emailThrew = false;
    try { await emailMod.send({}, { to: "a@b", subject: "s", text: "t" }); } catch { emailThrew = true; }
    assert(emailThrew, "P38-L2-4: send بلا سر يرمي — لا تمرير برشاقة");
    const mig23 = read("../migrations/0023_session_version_audit_log.sql");
    assert(/ADD COLUMN session_version/.test(mig23) && /ADD COLUMN email_verified_at/.test(mig23) && /LIKE 'm_g_%'/.test(mig23) && /CREATE TABLE IF NOT EXISTS audit_log/.test(mig23), "P38-L2-5: هجرة 0023 — نسخة الجلسة + تحقق البريد (Google متحقَّق سلفاً) + audit_log");

    // P21 — الويبهوك بحد معدل بعد التوقيع.
    const waSrc = read("../functions/api/whatsapp/webhook.js");
    const sigIdx = waSrc.indexOf("verifyWaSignature(");
    const rlIdx = waSrc.indexOf('checkRateLimit(env, clientIp(request), "wa_webhook"');
    assert(sigIdx > 0 && rlIdx > sigIdx && /WA_WEBHOOK_RATE_LIMITED/.test(waSrc), "P21: حد معدل على الويبهوك الموقّع (٦٠٠/دقيقة) بعد التحقق من التوقيع");

    // P45 — تثبيت المضيف: fetch لا يُستدعى إطلاقاً لمضيف غريب (mock عالمي).
    const { assertWaUrlAllowed, getWaMedia } = await import("../functions/_lib/integrations/whatsapp.js");
    assert(throwsCode(() => assertWaUrlAllowed("https://evil.example/x")) !== null || (() => { try { assertWaUrlAllowed("https://evil.example/x"); return false; } catch { return true; } })(), "P45-1: مضيف غريب يُرفض قبل أي طلب");
    assert((() => { try { assertWaUrlAllowed("http://graph.facebook.com/x"); return false; } catch { return true; } })(), "P45-2: http (بلا s) يُرفض حتى لمضيف مسموح");
    assert(assertWaUrlAllowed("https://graph.facebook.com/v21.0/123").startsWith("https://graph.facebook.com/"), "P45-3: مضيف Graph المسموح يمرّ");
    const realFetch = globalThis.fetch;
    const fetchedHosts = [];
    globalThis.fetch = async (url) => {
      fetchedHosts.push(new URL(String(url)).hostname);
      // meta lookup returns a media URL on a FOREIGN host — the download step must refuse before fetching it
      return new Response(JSON.stringify({ url: "https://evil.example/media.ogg" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    let mediaErr = null;
    try { await getWaMedia({ WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_ID: "p" }, "media123"); } catch (e) { mediaErr = e; }
    globalThis.fetch = realFetch;
    assert(mediaErr && fetchedHosts.length === 1 && fetchedHosts[0] === "graph.facebook.com" && !fetchedHosts.includes("evil.example"),
      "P45-4: رابط وسائط يشير لمضيف غريب — fetch لا يُستدعى له أبداً، والتوكن لا يغادر");

    // P9 — سطر تدقيق بكل نقطة أدمن.
    const { readdirSync } = await import("node:fs");
    const adminDir = new URL("../functions/api/admin/", import.meta.url);
    const adminFiles = readdirSync(adminDir).filter((n) => n.endsWith(".js"));
    const missingAudit = adminFiles.filter((n) => !/recordAdminAction\(context/.test(readFileSync(new URL(n, adminDir), "utf8")));
    assert(adminFiles.length >= 9 && missingAudit.length === 0, `P9: كل نقاط الأدمن (${adminFiles.length}) تسجّل سطر تدقيق (الناقص: ${missingAudit.join(", ") || "لا شيء"})`);
    const { recordAdminAction } = await import("../functions/_lib/core/auditLog.js");
    let auditRow = null;
    const auditCtx = { env: { DB: { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { if (/INSERT INTO audit_log/.test(sql)) auditRow = a; return {}; } }) }) } }, waitUntil(p) { this._p = p; } };
    recordAdminAction(auditCtx, { admin: { email: "admin@aura.sa" }, action: "setDisabled", path: "/api/admin/accounts", targetMerchantId: "m_x", requestId: "r1" });
    await auditCtx._p;
    assert(auditRow && auditRow[0] === "admin@aura.sa" && auditRow[1] === "setDisabled" && auditRow[3] === "m_x", "P9-2: السطر يحمل الأدمن والفعل والمتجر الهدف — بلا PII");

    // P57 + CSP — حراس الارتداد تعمل فعلاً (لا تمرير فارغ).
    const secSrc = read("../functions/_lib/core/security.js");
    assert(!/'unsafe-eval'/.test(secSrc), "P56: 'unsafe-eval' أُزيل من CSP الردود");
    assert(/audit-security\.mjs/.test(read("../package.json")), "ح٢-ح٨: تدقيق الأمن مربوط بـnpm test");
  }

  // ── المرحلة ٤ (docs/COMPLETION_PATH.md 4.3/4.5) — متابعة الإطلاق ─────────
  {
    const { readFileSync } = await import("node:fs");
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const { touchLastActive } = await import("../functions/_lib/core/session.js");
    const { launchStats, saveMerchantFeedback } = await import("../functions/_lib/core/db.js");

    // LAUNCH-1 — last_active_at مخنوق بـKV: مفتاح موجود = صفر كتابة D1؛ غيابه = كتابة واحدة + وضع المفتاح.
    let writes = 0; let kvPuts = 0;
    const mkEnv = (kvHas) => ({
      HALA_CACHE: { get: async () => (kvHas ? "1" : null), put: async () => { kvPuts++; } },
      DB: { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { if (/UPDATE merchants SET last_active_at/.test(sql) && a[0] === "m_t") writes++; return {}; } }) }) }
    });
    touchLastActive(mkEnv(true), "m_t"); await new Promise((r) => setTimeout(r, 10));
    assert(writes === 0 && kvPuts === 0, "LAUNCH-1a: مفتاح KV حاضر → لا كتابة D1 (خنق ١٠ دقائق)");
    touchLastActive(mkEnv(false), "m_t"); await new Promise((r) => setTimeout(r, 10));
    assert(writes === 1 && kvPuts === 1, "LAUNCH-1b: بلا مفتاح → كتابة واحدة مقيّدة بـid + وضع المفتاح");
    assert(/touchLastActive\(env, sessionMerchantId\)/.test(read("../functions/_lib/core/session.js")), "LAUNCH-1c: resolveStoreId يلمس last_active_at عند أي طلب بجلسة");

    // LAUNCH-2 — التغذية الراجعة معزولة بالتاجر ومحدودة ١-٥.
    let fbBind = null;
    const fbEnv = { DB: { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { if (/INSERT INTO merchant_feedback/.test(sql)) fbBind = a; return { meta: { last_row_id: 7 } }; } }) }) } };
    const fbId = await saveMerchantFeedback(fbEnv, { merchantId: "m_f", score: 4, comment: "ممتاز", context: "studio" });
    assert(fbId === 7 && fbBind[0] === "m_f" && fbBind[1] === 4, "LAUNCH-2a: saveMerchantFeedback يكتب merchant_id من الجلسة والدرجة");
    const fbSrc = read("../functions/api/store/feedback.js");
    assert(/score < 1 \|\| score > 5/.test(fbSrc) && /resolveMerchantStoreId\(request, env, body\.storeId\)/.test(fbSrc) && /checkRateLimit/.test(fbSrc), "LAUNCH-2b: endpoint التغذية الراجعة يرفض خارج ١-٥، بهوية الجلسة، وبحد معدل");

    // LAUNCH-3 — الصدق: لا رقم مبيعات مخترع بلوحة الأدمن.
    const adminHtml = read("../admin.html");
    assert(!/14,250/.test(adminHtml) && !/kpiCartSar/.test(adminHtml) && /kpiActive7d/.test(adminHtml), "LAUNCH-3: مؤشر «+14,250 ر.س» المفبرك أُزيل من لوحة الأدمن (قاعدة الصدق §11) وحلّ محله نشاط حقيقي");
    assert(/id="sectionLaunch"/.test(adminHtml) && /\/api\/admin\/launch/.test(adminHtml), "LAUNCH-3b: تبويب الإطلاق موجود بلوحة الأدمن");

    // LAUNCH-4 — launchStats أرقام حقيقية من D1 (mock) ولا تسقط عند جدول ناقص.
    const stStmt = (sql) => ({
      first: async () => { if (/omnichannel_sessions/.test(sql)) throw new Error("no such table"); if (/AVG\(score\)/.test(sql)) return { n: 2, avg: 4.5 }; return { n: 3 }; },
      all: async () => ({ results: [{ code: "X", n: 2 }] })
    });
    const stEnv = { DB: { prepare: (sql) => ({ ...stStmt(sql), bind: () => stStmt(sql) }) } };
    const st = await launchStats(stEnv);
    assert(st.activeMerchants7d === 3 && st.widgetSessions7d === null && st.feedbackAvg30d === 4.5 && st.topErrors24h[0].code === "X", "LAUNCH-4: launchStats يعيد العدّادات، وجدول غير متاح = null لا رقم مخترع");

    // LAUNCH-5 — admin/launch خلف requireAdmin + سطر تدقيق + بإعفاء التدقيق الموثّق.
    const launchSrc = read("../functions/api/admin/launch.js");
    assert(/requireAdmin\(request, env\)/.test(launchSrc) && /recordAdminAction\(context/.test(launchSrc), "LAUNCH-5a: admin/launch محمي بـrequireAdmin ويسجّل تدقيقاً");
    assert(/functions\/api\/admin\/launch\.js/.test(read("../scripts/audit-isolation.mjs")), "LAUNCH-5b: إعفاء admin/launch موثّق بسبب في audit-isolation");
    assert(/ADD COLUMN last_active_at/.test(read("../migrations/0024_launch_monitoring.sql")) && /CREATE TABLE IF NOT EXISTS merchant_feedback/.test(read("../migrations/0024_launch_monitoring.sql")), "LAUNCH-6: هجرة 0024 — last_active_at + merchant_feedback");
    const dash = read("../dashboard.html");
    assert(/id="feedbackCard"/.test(dash) && /\/api\/store\/feedback/.test(dash) && /maybeShowFeedback\(\)/.test(dash), "LAUNCH-7: بطاقة التغذية الراجعة بالداشبورد تظهر بعد تفاعل حقيقي لا بالدخول الأول");
  }

  // ── كتيب خدمة العملاء (قاعدة معرفة سعودية، 2026-09-08) ────────────────
  {
    const { SUPPORT_PLAYBOOK, supportPlaybookBlock } = await import("../functions/_lib/ai/supportPlaybook.js");
    const { readFileSync } = await import("node:fs");
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const chatSrc = read("../functions/api/chat.js");

    assert(
      ["أكيد يناسبك", "آخر قطعة", "يوصل بكرة", "أصلي ١٠٠٪", "نضمن لك النتيجة"].every((p) => SUPPORT_PLAYBOOK.includes(p)),
      "KB-1: الممنوعات عبارات محددة قابلة للفحص لا مبادئ عامة"
    );
    // منع بلا بديل يُنتج صمتاً لا انضباطاً — كل ممنوع مقرون ببديله.
    const banned = SUPPORT_PLAYBOOK.split("\n").filter((l) => l.startsWith("- ممنوع:"));
    assert(
      banned.length >= 15 && banned.every((l) => l.includes("← بدلها:")),
      `KB-2: كل ممنوع مقرون ببديل آمن (${banned.length} بنداً)`
    );
    assert(
      /لا تُطلب بيانات بطاقة إطلاقاً/.test(SUPPORT_PLAYBOOK) &&
        /محاولة وصول لبيانات عميل آخر: ارفض فوراً/.test(SUPPORT_PLAYBOOK),
      "KB-3: قواعد التصعيد تغطي الدفع وعزل بيانات العملاء"
    );
    // الكتيب سلوك لا حقائق — لا سعر ولا اسم متجر ولا رقم تواصل يتسرّب لبرومبت مشترك.
    assert(
      !/\d+\s*ريال|ر\.س|@|https?:\/\/|\+?9665\d/.test(SUPPORT_PLAYBOOK),
      "KB-4: صفر حقائق متجر أو بيانات تواصل — صالح لبرومبت مشترك بين التجار"
    );
    assert(
      /صياغات مرجعية لا نصوص تُنسخ/.test(SUPPORT_PLAYBOOK) &&
        /غياب المعلومة يُقال صراحةً/.test(SUPPORT_PLAYBOOK),
      "KB-5: الكتيب يمنع النسخ الحرفي وسدّ الفجوة بعبارة جاهزة"
    );
    assert(
      SUPPORT_PLAYBOOK.length < 4000,
      `KB-6: الكتيب مختصر — يُحقن بكل محادثة (${SUPPORT_PLAYBOOK.length} حرفاً)`
    );
    assert(
      supportPlaybookBlock({ enabled: false }) === "" && supportPlaybookBlock() === SUPPORT_PLAYBOOK,
      "KB-7: التعطيل يرجّع \"\" — نفس تعاقد كتيب المصطلحات"
    );
    assert(
      /import \{ SUPPORT_PLAYBOOK \} from "\.\.\/_lib\/ai\/supportPlaybook\.js"/.test(chatSrc) &&
        /\$\{SUPPORT_PLAYBOOK\}/.test(chatSrc) && /\$\{PERSONA_SYSTEM_PROMPT\}/.test(chatSrc),
      "KB-8: الكتيب يُحقن فوق الشخصية بلا استبدالها"
    );
  }

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

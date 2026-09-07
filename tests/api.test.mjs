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
  const adminEnv = { ADMIN_EMAILS: " Admin@Aura.SA , second@aura.sa ", SESSION_SECRET: env.SESSION_SECRET };
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

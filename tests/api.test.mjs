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

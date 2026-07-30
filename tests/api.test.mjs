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
  const bookingId = await saveConsultationBooking(mockEnvDb, { name: "Test", phone: "123", slotLabel: "Slot 1" });
  assert(bookingId === 1234, "saveConsultationBooking returned correct ID");
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

  // 6. Test New Endpoints: Report, OCR Bank Verification, Voice Note Generator
  const reportMod = await import("../functions/api/store/report.js");
  assert(typeof reportMod.onRequestPost === "function", "report.js exports valid onRequestPost middleware");

  const ocrMod = await import("../functions/api/store/ocr.js");
  assert(typeof ocrMod.onRequestPost === "function", "ocr.js exports valid onRequestPost middleware");

  const voiceMod = await import("../functions/api/store/voice.js");
  assert(typeof voiceMod.onRequestPost === "function", "voice.js exports valid onRequestPost middleware");

  // 7. Test Saudi Market Endpoints: ZATCA Stage 2 E-Invoice & Saudi Shipping Webhook
  const zatcaMod = await import("../functions/api/store/zatca.js");
  assert(typeof zatcaMod.onRequestPost === "function", "zatca.js exports valid onRequestPost middleware");

  const shippingMod = await import("../functions/api/webhooks/shipping.js");
  assert(typeof shippingMod.onRequestPost === "function", "shipping.js exports valid onRequestPost middleware");

  // 8. Test Merchant Custom Agent Persona Studio API & Recovery API
  const personaMod = await import("../functions/api/store/persona.js");
  assert(typeof personaMod.onRequestPost === "function", "persona.js exports valid onRequestPost middleware");

  // 9. Test Trendyol Marketplace API & Webhook Compliance
  const tyMod = await import("../functions/_lib/integrations/trendyol.js");
  const tyHeadersRes = tyMod.tyHeaders({ api_key: "k123", api_secret: "s456", seller_id: "7890" });
  assert(tyHeadersRes["User-Agent"] === "7890 - SelfIntegration", "Trendyol User-Agent header matches documentation");

  const tyWebhookMod = await import("../functions/api/webhooks/trendyol.js");
  assert(typeof tyWebhookMod.onRequestPost === "function", "webhooks/trendyol.js exports valid onRequestPost middleware");

  // 10. Test AI Campaign & Coupon Studio API
  const campaignMod = await import("../functions/api/store/campaign.js");
  assert(typeof campaignMod.onRequestPost === "function", "campaign.js exports valid onRequestPost middleware");

  const generatedCmp = campaignMod.generateAiCampaignMessage({ idea: "عروض الصيف الفاخرة", discountCode: "SUMMER20", discountPercent: 20 });
  assert(generatedCmp.includes("SUMMER20"), "AI campaign message generation includes discount code SUMMER20");

  // 11. Test Password Reset & OTP Recovery API & Google OAuth (Agent G Requirements)
  const forgotMod = await import("../functions/api/auth/forgot_password.js");
  assert(typeof forgotMod.onRequestPost === "function", "forgot_password.js exports valid onRequestPost middleware");

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

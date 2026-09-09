import { createRunner } from "../_helpers.mjs";
import { matchFastIntent } from "../../functions/_lib/ai/intents.js";
import { hashPassword, verifyPassword } from "../../functions/_lib/core/auth.js";
import { saveConsultationBooking } from "../../functions/_lib/core/db.js";

const { assert, done } = createRunner("core-smoke");

async function main() {
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

  // 5. Security Module (Sanitizer, Security Headers, Turnstile)
  const { sanitizeInput, getSecurityHeaders, verifyTurnstileToken } = await import("../../functions/_lib/core/security.js");
  const dirtyInput = "<script>alert('xss')</script>hello <b onload='evil()'>world</b>";
  const cleanInput = sanitizeInput(dirtyInput);
  assert(!cleanInput.includes("<script>") && !cleanInput.includes("onload="), `sanitizeInput stripped scripts and HTML tags: "${cleanInput}"`);

  const headers = getSecurityHeaders();
  assert(headers["X-Frame-Options"] === "DENY", "getSecurityHeaders returns X-Frame-Options DENY");
  assert(headers["X-Content-Type-Options"] === "nosniff", "getSecurityHeaders returns X-Content-Type-Options nosniff");

  const turnstileDev = await verifyTurnstileToken({}, "dummy_token");
  assert(turnstileDev.success && turnstileDev.bypass, "verifyTurnstileToken passes gracefully when secret key is unset");
}

main()
  .then(() => done())
  .catch((e) => {
    console.error("❌ Tests threw an exception:");
    console.error(e);
    process.exit(1);
  });

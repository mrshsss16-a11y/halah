import { createRunner } from "../_helpers.mjs";
import { createSessionVersionKv, createRlKv, TEST_SESSION_SECRET } from "../_helpers.mjs";

const { assert, done } = createRunner("auth-reset");

async function main() {
  const env = { SESSION_SECRET: TEST_SESSION_SECRET, HALA_CACHE: createSessionVersionKv() };
  const rlKv = createRlKv();
  {
    const { onRequestPost: resetPost } = await import("../../functions/api/auth/reset_password.js");

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
      return { state, env: { DB: db, SESSION_SECRET: env.SESSION_SECRET, HALA_CACHE: rlKv } };
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
}

main()
  .then(() => done())
  .catch((e) => {
    console.error("❌ Tests threw an exception:");
    console.error(e);
    process.exit(1);
  });

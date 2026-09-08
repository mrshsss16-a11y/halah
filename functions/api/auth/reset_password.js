// POST /api/auth/reset_password — confirm OTP and set a new password.
//
// SECURITY: the OTP is actually verified here (hashed compare, timing-safe,
// expiry-checked, single-use). The previous version accepted any OTP string and
// rewrote the password — a complete account-takeover path.
import { withApi, json } from "../../_lib/core/respond.js";
import { hashPassword } from "../../_lib/core/auth.js";
import { sanitizeInput } from "../../_lib/core/security.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { logError } from "../../_lib/core/errorLog.js";
import { bumpSessionVersion } from "../../_lib/core/session.js";
import {
  isResetOtpLocked,
  recordResetOtpFailure,
  clearResetOtpAttempts
} from "../../_lib/core/db.js";

async function hashOtp(email, otp) {
  const data = new TextEncoder().encode(`${email}:${otp}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Records one failed OTP entry. A DB error here is logged but not surfaced —
// the caller is already returning the generic `invalid` response either way.
async function countResetFailure(env, email, request) {
  try {
    await recordResetOtpFailure(env, email);
  } catch (err) {
    logError({ env }, {
      requestId: request.headers.get("cf-ray") || null,
      path: "/api/auth/reset_password",
      code: "reset_failure_record_failed",
      internal: err?.message
    });
  }
}

async function resetPasswordHandler(body, env, request) {
  const ip = clientIp(request);
  const rateCheck = await checkRateLimit(env, ip, "reset_password", 10, 60);
  if (!rateCheck.allowed) {
    return json({ ok: false, error: `محاولات كثيرة جداً. حاول بعد ${rateCheck.resetInSeconds} ثانية.` }, 429);
  }

  const email = sanitizeInput((body?.email || "").toString().trim().toLowerCase(), 200);
  const otpCode = (body?.otpCode || "").toString().trim();
  const newPassword = (body?.newPassword || "").toString();

  if (!email || !otpCode || !newPassword) {
    return json({ ok: false, error: "يرجى ملء كافة البيانات المطلوبة." }, 400);
  }
  if (newPassword.length < 8) {
    return json({ ok: false, error: "كلمة المرور الجديدة يجب أن تكون 8 خانات على الأقل." }, 400);
  }
  if (!env?.DB) {
    return json({ ok: false, error: "الخدمة غير متاحة حالياً." }, 503);
  }

  // Same message for every failure mode (wrong code, expired, no request on
  // file) so this can't be used to probe which emails have pending resets.
  const invalid = { ok: false, error: "رمز التحقق غير صحيح أو منتهي الصلاحية." };

  // P39: per-email guess counter. checkRateLimit() above is per-IP and fails
  // OPEN when KV is down, so it cannot be the only guard on a 6-digit code.
  // This one fails CLOSED: if we can't read the counter we refuse the reset
  // rather than hand out an unlimited-guess window.
  try {
    if (await isResetOtpLocked(env, email)) return json(invalid, 400);
  } catch (err) {
    logError({ env }, {
      requestId: request.headers.get("cf-ray") || null,
      path: "/api/auth/reset_password",
      code: "reset_lockout_check_failed",
      internal: err?.message
    });
    return json({ ok: false, error: "الخدمة غير متاحة حالياً." }, 503);
  }

  const row = await env.DB.prepare(
    "SELECT otp_code FROM password_resets WHERE email = ? AND expires_at > datetime('now')"
  )
    .bind(email)
    .first()
    .catch(() => null);

  // Counts against the same budget as a wrong code: an attacker must not be
  // able to tell "no pending reset" apart from "wrong code" by probing.
  if (!row?.otp_code) {
    await countResetFailure(env, email, request);
    return json(invalid, 400);
  }

  const providedHash = await hashOtp(email, otpCode);
  if (!timingSafeEqual(providedHash, row.otp_code)) {
    // On the 5th failure this burns the OTP row outright, so even the correct
    // code is dead afterwards and a new one must be requested.
    await countResetFailure(env, email, request);
    return json(invalid, 400);
  }

  const { hash, salt } = await hashPassword(newPassword);
  // tenant-audit-ok: password reset is keyed by the OTP-verified email — the
  // OTP check above (timingSafeEqual against row.otp_code) is what proves
  // ownership, not a merchant_id condition on this UPDATE.
  const update = await env.DB.prepare(
    "UPDATE accounts SET password_hash = ?, password_salt = ? WHERE email = ?"
  )
    .bind(hash, salt, email)
    .run()
    .catch(() => null);

  if (!update) return json({ ok: false, error: "تعذر تحديث كلمة المرور." }, 500);

  // P40 — a password reset must evict whoever holds the old sessions (the
  // attacker the victim is resetting to get rid of). Lookup by the OTP-verified
  // email, then bump. Failure here is logged, not swallowed: the reset already
  // succeeded, but an un-evicted session is exactly the gap P40 closes.
  // tenant-audit-ok: email is the OTP-verified identity (see UPDATE above).
  const owner = await env.DB.prepare("SELECT merchant_id FROM accounts WHERE email = ?").bind(email).first().catch(() => null);
  if (owner?.merchant_id) {
    await bumpSessionVersion(env, owner.merchant_id).catch((e) =>
      logError({ env }, { requestId: null, path: "/api/auth/reset_password", code: "SESSION_BUMP_FAILED", storeId: owner.merchant_id, internal: e?.message })
    );
  }

  // Single use: burn the OTP so it can't be replayed.
  await env.DB.prepare("DELETE FROM password_resets WHERE email = ?").bind(email).run().catch(() => {});
  // Clear any lockout from failed logins before the reset.
  await env.DB.prepare("DELETE FROM login_attempts WHERE email = ?").bind(email).run().catch(() => {});
  // …and the per-email OTP guess counter (namespaced key, separate row).
  await clearResetOtpAttempts(env, email).catch(() => {});

  return json({ ok: true, message: "تم تحديث كلمة المرور بنجاح. تقدر تسجل دخولك الآن." });
}

export const onRequestPost = withApi(resetPasswordHandler);

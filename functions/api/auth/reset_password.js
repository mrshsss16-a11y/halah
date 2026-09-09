// POST /api/auth/reset_password — confirm OTP and set a new password.
//
// SECURITY: the OTP is actually verified here (hashed compare, timing-safe,
// expiry-checked, single-use). Every failure mode returns the SAME message so
// this can't be used to probe which emails have a pending reset.
import { withApi, json } from "../../_lib/core/respond.js";
// Q1/Q3 — تجزئة الرمز والمقارنة الثابتة الزمن من مصدر واحد بدل نسختين محليتين.
import { hashPassword, hashOtp } from "../../_lib/core/auth.js";
import { timingSafeEqualStr } from "../../_lib/core/crypto.js";
import { sanitizeInput } from "../../_lib/core/security.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { logError } from "../../_lib/core/errorLog.js";
import { bumpSessionVersion } from "../../_lib/core/session.js";
import { findMerchantIdByEmail } from "../../_lib/domain/accounts.js";
import {
  isResetOtpLocked, recordResetOtpFailure, clearResetOtpAttempts, clearLoginAttempts,
  pendingResetOtpHash, setPasswordForEmail, consumePasswordReset
} from "../../_lib/domain/auth.js";

const log = (env, code, extra = {}) =>
  logError({ env }, { requestId: null, path: "/api/auth/reset_password", code, ...extra });

async function resetPasswordHandler(body, env, request) {
  const rl = await checkRateLimit(env, clientIp(request), "reset_password", 10, 60, { failClosed: true });
  if (!rl.allowed) return json({ ok: false, error: `محاولات كثيرة جداً. حاول بعد ${rl.resetInSeconds} ثانية.` }, 429);

  const email = sanitizeInput((body?.email || "").toString().trim().toLowerCase(), 200);
  const otpCode = (body?.otpCode || "").toString().trim();
  const newPassword = (body?.newPassword || "").toString();

  if (!email || !otpCode || !newPassword) return json({ ok: false, error: "يرجى ملء كافة البيانات المطلوبة." }, 400);
  if (newPassword.length < 8) return json({ ok: false, error: "كلمة المرور الجديدة يجب أن تكون 8 خانات على الأقل." }, 400);
  if (!env?.DB) return json({ ok: false, error: "الخدمة غير متاحة حالياً." }, 503);

  const invalid = { ok: false, error: "رمز التحقق غير صحيح أو منتهي الصلاحية." };
  // Counts against the same budget as a wrong code (no "no pending reset" oracle).
  const countFailure = () =>
    recordResetOtpFailure(env, email).catch((err) => log(env, "reset_failure_record_failed", { internal: err?.message }));

  // P39: per-email guess counter. checkRateLimit above is per-IP and fails OPEN
  // when KV is down, so it cannot be the only guard on a 6-digit code. This one
  // fails CLOSED: an unreadable counter refuses the reset.
  try {
    if (await isResetOtpLocked(env, email)) return json(invalid, 400);
  } catch (err) {
    log(env, "reset_lockout_check_failed", { internal: err?.message });
    return json({ ok: false, error: "الخدمة غير متاحة حالياً." }, 503);
  }

  const storedHash = await pendingResetOtpHash(env, email);
  if (!storedHash) {
    await countFailure();
    return json(invalid, 400);
  }
  if (!timingSafeEqualStr(await hashOtp(email, otpCode), storedHash)) {
    // On the 5th failure this burns the OTP row outright.
    await countFailure();
    return json(invalid, 400);
  }

  const { hash, salt } = await hashPassword(newPassword);
  if (!(await setPasswordForEmail(env, { email, hash, salt }))) return json({ ok: false, error: "تعذر تحديث كلمة المرور." }, 500);

  // P40 — a reset must evict whoever holds the old sessions (the attacker the
  // victim is resetting to get rid of). Failure is logged, not swallowed.
  const owner = await findMerchantIdByEmail(env, email).catch(() => null);
  if (owner) await bumpSessionVersion(env, owner).catch((e) => log(env, "SESSION_BUMP_FAILED", { storeId: owner, internal: e?.message }));

  // Q2 — فشل التنظيف يستحق أثراً: رمز باقٍ = قابل لإعادة الاستخدام، وعدّاد
  // باقٍ = حساب مقفل بعد إعادة تعيين ناجحة. (بلا بريد بالسجل.)
  const onCleanupFailure = (code) => (err) => log(env, code, { internal: err?.message || String(err) });
  await consumePasswordReset(env, email).catch(onCleanupFailure("RESET_OTP_DELETE_FAILED"));
  await clearLoginAttempts(env, email).catch(onCleanupFailure("RESET_LOGIN_ATTEMPTS_CLEAR_FAILED"));
  await clearResetOtpAttempts(env, email).catch(onCleanupFailure("RESET_OTP_ATTEMPTS_CLEAR_FAILED"));

  return json({ ok: true, message: "تم تحديث كلمة المرور بنجاح. تقدر تسجل دخولك الآن." });
}

export const onRequestPost = withApi(resetPasswordHandler);

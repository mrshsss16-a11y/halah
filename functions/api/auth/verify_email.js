// POST /api/auth/verify_email — body: { code } — يثبت ملكية بريد حساب الجلسة.
//
// الحارس: ٥ محاولات خاطئة تحرق الرمز (يُحذف الصف) — لا نافذة تخمين مفتوحة على ٦ أرقام.
// العدّاد يزيد **قبل** المقارنة وبنفس الصف (atomic UPDATE) — لا سباق بين طلبين متوازيين.
import { withApi, json } from "../../_lib/core/respond.js";
import { getSessionMerchantId } from "../../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { timingSafeEqualStr } from "../../_lib/core/crypto.js";
import { hashVerificationCode } from "./send_verification.js";

const MAX_ATTEMPTS = 5;

async function verifyEmailHandler(body, env, request) {
  const rl = await checkRateLimit(env, clientIp(request), "verify_email", 10, 60, { failClosed: true });
  if (!rl.allowed) {
    return json({ ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" }, 429);
  }

  const merchantId = await getSessionMerchantId(request, env);
  if (!merchantId) return json({ ok: false, error: "سجّل دخولك أولاً.", code: "LOGIN_REQUIRED" }, 401);
  if (!env?.DB) return json({ ok: false, error: "الخدمة غير متاحة حالياً.", code: "DB_UNAVAILABLE" }, 503);

  const code = String(body?.code || "").trim();
  if (!/^\d{6}$/.test(code)) return json({ ok: false, error: "أدخل رمز التحقق المكوّن من ٦ أرقام." }, 400);

  const account = await env.DB.prepare("SELECT email, email_verified_at FROM accounts WHERE merchant_id = ?").bind(merchantId).first();
  if (!account?.email) return json({ ok: false, error: "أكمل تسجيل حسابك أولاً.", code: "ACCOUNT_REQUIRED" }, 403);
  if (account.email_verified_at) return json({ ok: true, alreadyVerified: true });

  const invalid = { ok: false, error: "رمز التحقق غير صحيح أو منتهي الصلاحية.", code: "CODE_INVALID" };

  // عدّ المحاولة أولاً (ذرّي)، ثم اقرأ — الصف الغائب/المنتهي يُعامَل كرمز خاطئ بلا تمييز.
  // tenant-audit-ok: email هو مفتاح الجدول وهو بريد حساب الجلسة نفسه (قُرئ بشرط merchant_id أعلاه).
  const row = await env.DB.prepare(
    `UPDATE email_verifications SET attempts = attempts + 1
      WHERE email = ? AND expires_at > datetime('now')
      RETURNING code_hash, attempts`
  )
    .bind(account.email)
    .first();
  if (!row) return json(invalid, 400);

  if (row.attempts > MAX_ATTEMPTS) {
    await env.DB.prepare("DELETE FROM email_verifications WHERE email = ?").bind(account.email).run().catch(() => {});
    return json({ ok: false, error: "تجاوزت عدد المحاولات — اطلب رمزاً جديداً.", code: "CODE_BURNED" }, 400);
  }

  const providedHash = await hashVerificationCode(account.email, code);
  if (!timingSafeEqualStr(providedHash, row.code_hash)) return json(invalid, 400);

  await env.DB.batch([
    env.DB.prepare("UPDATE accounts SET email_verified_at = datetime('now') WHERE merchant_id = ?").bind(merchantId),
    env.DB.prepare("DELETE FROM email_verifications WHERE email = ?").bind(account.email)
  ]);
  return json({ ok: true, message: "تم تأكيد بريدك ✅" });
}

export const onRequestPost = withApi(verifyEmailHandler);

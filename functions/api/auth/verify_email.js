// POST /api/auth/verify_email — body: { code } — يثبت ملكية بريد حساب الجلسة.
//
// الحارس: ٥ محاولات خاطئة تحرق الرمز (يُحذف الصف) — لا نافذة تخمين مفتوحة على ٦ أرقام.
// العدّاد يزيد **قبل** المقارنة وبنفس الصف (atomic UPDATE) — لا سباق بين طلبين متوازيين.
import { withApi, json } from "../../_lib/core/respond.js";
import { getSessionMerchantId } from "../../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { timingSafeEqualStr } from "../../_lib/core/crypto.js";
import {
  accountVerificationState, consumeEmailVerification, burnEmailVerification,
  markEmailVerified, hashVerificationCode
} from "../../_lib/domain/auth.js";

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

  const account = await accountVerificationState(env, merchantId);
  if (!account?.email) return json({ ok: false, error: "أكمل تسجيل حسابك أولاً.", code: "ACCOUNT_REQUIRED" }, 403);
  if (account.email_verified_at) return json({ ok: true, alreadyVerified: true });

  const invalid = { ok: false, error: "رمز التحقق غير صحيح أو منتهي الصلاحية.", code: "CODE_INVALID" };

  const row = await consumeEmailVerification(env, account.email);
  if (!row) return json(invalid, 400);

  if (row.attempts > MAX_ATTEMPTS) {
    await burnEmailVerification(env, account.email);
    return json({ ok: false, error: "تجاوزت عدد المحاولات — اطلب رمزاً جديداً.", code: "CODE_BURNED" }, 400);
  }

  if (!timingSafeEqualStr(await hashVerificationCode(account.email, code), row.code_hash)) return json(invalid, 400);

  await markEmailVerified(env, { merchantId, email: account.email });
  return json({ ok: true, message: "تم تأكيد بريدك ✅" });
}

export const onRequestPost = withApi(verifyEmailHandler);

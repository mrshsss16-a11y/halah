// POST /api/auth/salla_google — body: { credential }
//
// تاجر فتح هالة من داخل سلة (جلسة لصفّ متجره بلا حساب) ويكمل حسابه بجوجل بدل بريد وكلمة مرور
// (طلب المالك 2026-09-14). ثلاث حالات بحسب بريد جوجل المتحقَّق:
//   - بريد جديد            ⇒ حساب لصفّ المتجر نفسه (كـcomplete_account، بكلمة مرور عشوائية غير قابلة للاستخدام).
//   - حساب جوجل من موقعنا  ⇒ ينتقل لصفّ المتجر (كـclaim_store؛ جوجل أثبتت الملكية بدل كلمة المرور).
//   - حساب بكلمة مرور      ⇒ رفض يوجّه لـ«عندك حساب؟» — لا ربط تلقائي لحساب كلمة مرور (P41 بـgoogle.js).
//
// SECURITY: صفّ المتجر من كوكي الجلسة فقط، والهوية من رد جوجل وحده (aud = GOOGLE_CLIENT_ID).
import { withApi, json } from "../../_lib/core/respond.js";
import { hashPassword } from "../../_lib/core/auth.js";
import { getSessionMerchantId, createSessionToken, sessionCookieHeader } from "../../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { isAdminEmail } from "../../_lib/core/adminEmails.js";
import { verifyGoogleIdToken } from "../../_lib/domain/auth.js";
import { lookupAccountForGoogle, merchantExists, accountEmailFor, completeAccount } from "../../_lib/domain/accounts.js";
import { claimStoreWithGoogleAccount, ClaimError } from "../../_lib/domain/accountClaim.js";

const PASSWORD_ACCOUNT = "هذا البريد له حساب بكلمة مرور عندنا — اضغط «عندك حساب بموقعنا؟» وادخل بكلمة المرور ليُربط المتجر به.";

async function sallaGoogleHandler(body, env, request) {
  const rl = await checkRateLimit(env, clientIp(request), "salla_google", 10, 3600, { failClosed: true });
  if (!rl.allowed) return json({ ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" }, 429);

  const storeMerchantId = await getSessionMerchantId(request, env);
  if (!storeMerchantId) return json({ ok: false, error: "افتح هالة من داخل لوحة متجرك بسلة أولاً.", code: "LOGIN_REQUIRED" }, 401);
  if (!env?.GOOGLE_CLIENT_ID) return json({ ok: false, error: "الدخول بجوجل غير مفعّل حالياً.", code: "GOOGLE_NOT_CONFIGURED" }, 503);

  const identity = await verifyGoogleIdToken(env, String(body?.credential || "")).catch(() => null);
  if (!identity) return json({ ok: false, error: "تعذر التحقق من حساب جوجل." }, 401);
  const email = identity.email.slice(0, 200);
  if (isAdminEmail(env, email)) return json({ ok: false, error: PASSWORD_ACCOUNT, code: "PASSWORD_ACCOUNT_EXISTS" }, 409);

  const account = await lookupAccountForGoogle(env, email);
  if (account.exists && !account.isGoogleAccount) return json({ ok: false, error: PASSWORD_ACCOUNT, code: "PASSWORD_ACCOUNT_EXISTS" }, 409);

  if (account.exists) {
    try {
      const { merchantId } = await claimStoreWithGoogleAccount(env, { storeMerchantId, email });
      const token = await createSessionToken(env, merchantId);
      return json({ ok: true, storeId: merchantId, email, linked: true }, 200, { "Set-Cookie": sessionCookieHeader(token) });
    } catch (err) {
      if (err instanceof ClaimError) return json({ ok: false, error: err.message, code: err.code }, err.status);
      throw err;
    }
  }

  if (!(await merchantExists(env, storeMerchantId))) return json({ ok: false, error: "المتجر غير موجود.", code: "MERCHANT_NOT_FOUND" }, 404);
  if (await accountEmailFor(env, storeMerchantId)) return json({ ok: false, error: "حسابك مكتمل مسبقاً.", code: "ACCOUNT_EXISTS" }, 409);
  const rnd = crypto.getRandomValues(new Uint8Array(32));
  const { hash, salt } = await hashPassword(Array.from(rnd, (b) => b.toString(16).padStart(2, "0")).join(""));
  await completeAccount(env, { merchantId: storeMerchantId, email, hash, salt });
  return json({ ok: true, storeId: storeMerchantId, email, linked: false });
}

export const onRequestPost = withApi(sallaGoogleHandler);

// POST /api/auth/salla_google — body: { credential, nonce? }
//
// تاجر فتح هالة من داخل سلة (صف متجر بلا حساب) ويكمل حسابه بجوجل (طلب المالك 2026-09-14). صف المتجر:
//   - من كوكي الجلسة (زر جوجل داخل الإطار)، أو
//   - من رمز لمرة واحدة `nonce` أصدره الإطار نفسه بجلسته (نافذة /google-link المستقلة لا ترى كوكي الإطار المقسَّم).
// ثلاث حالات بحسب بريد جوجل المتحقَّق:
//   - بريد جديد            ⇒ حساب لصف المتجر نفسه (بكلمة مرور عشوائية غير قابلة للاستخدام).
//   - حساب جوجل من موقعنا  ⇒ ينتقل لصف المتجر (جوجل أثبتت الملكية بدل كلمة المرور).
//   - حساب بكلمة مرور/مشرف ⇒ رفض يوجّه لـ«عندك حساب؟» — لا ربط تلقائي لحساب كلمة مرور (P41).
import { withApi, json } from "../../_lib/core/respond.js";
import { hashPassword } from "../../_lib/core/auth.js";
import { getSessionMerchantId, createSessionToken, sessionCookieHeader } from "../../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { isAdminEmail } from "../../_lib/core/adminEmails.js";
import { verifyGoogleIdToken } from "../../_lib/domain/auth.js";
import { lookupAccountForGoogle, merchantExists, accountEmailFor, completeAccount } from "../../_lib/domain/accounts.js";
import { claimStoreWithGoogleAccount, ClaimError } from "../../_lib/domain/accountClaim.js";
import { consumeGoogleLinkNonce } from "../../_lib/domain/googleLink.js";

const PASSWORD_ACCOUNT = "هذا البريد له حساب بكلمة مرور عندنا — اضغط «عندك حساب بموقعنا؟» وادخل بكلمة المرور ليُربط المتجر به.";

async function sallaGoogleHandler(body, env, request) {
  const rl = await checkRateLimit(env, clientIp(request), "salla_google", 10, 3600, { failClosed: true });
  if (!rl.allowed) return json({ ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" }, 429);
  if (!env?.GOOGLE_CLIENT_ID) return json({ ok: false, error: "الدخول بجوجل غير مفعّل حالياً.", code: "GOOGLE_NOT_CONFIGURED" }, 503);

  const identity = await verifyGoogleIdToken(env, String(body?.credential || "")).catch(() => null);
  if (!identity) return json({ ok: false, error: "تعذر التحقق من حساب جوجل." }, 401);

  const nonce = String(body?.nonce || "");
  const storeMerchantId = nonce ? await consumeGoogleLinkNonce(env, nonce) : await getSessionMerchantId(request, env);
  if (!storeMerchantId) {
    const error = nonce ? "انتهت صلاحية رابط الدخول — ارجع لهالة في سلة واضغط «أكمل بجوجل» مرة ثانية." : "افتح هالة من داخل لوحة متجرك بسلة أولاً.";
    return json({ ok: false, error, code: "LOGIN_REQUIRED" }, 401);
  }

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

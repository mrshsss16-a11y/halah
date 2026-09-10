// POST /api/auth/claim_store — body: { email, password }
//
// التاجر فتح هالة من داخل سلة (جلسة لصفّ متجره بلا حساب)، وعنده حساب أُنشئ من
// موقعنا. هنا يُثبت ملكية الحساب بكلمة مروره فيُربط المتجر به. تنسيق فقط؛ القرار
// والنقل بـ`domain/accountClaim.js`.
//
// SECURITY: صفّ المتجر من **كوكي الجلسة فقط** — لا من الجسم. قبول معرّف من
// العميل يعني أن أي صاحب حساب يربط متجر غيره بحسابه (استيلاء كامل).
import { withApi, json } from "../../_lib/core/respond.js";
import { getSessionMerchantId, createSessionToken, sessionCookieHeader } from "../../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { EMAIL_RE } from "../../_lib/core/security.js";
import { claimStoreWithAccount, ClaimError } from "../../_lib/domain/accountClaim.js";

async function claimStoreHandler(body, env, request) {
  const rl = await checkRateLimit(env, clientIp(request), "claim_store", 10, 3600, { failClosed: true });
  if (!rl.allowed) {
    return json({ ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" }, 429);
  }

  const storeMerchantId = await getSessionMerchantId(request, env);
  if (!storeMerchantId) {
    return json({ ok: false, error: "افتح هالة من داخل لوحة متجرك بسلة أولاً.", code: "LOGIN_REQUIRED" }, 401);
  }

  const email = (body.email || "").toString().trim().toLowerCase().slice(0, 200);
  const password = (body.password || "").toString();
  if (!EMAIL_RE.test(email) || !password) {
    return json({ ok: false, error: "أدخل بريدك وكلمة مرورك." }, 400);
  }

  try {
    const { merchantId, email: accountEmail } = await claimStoreWithAccount(env, { storeMerchantId, email, password });
    // نسخة الجلسة رُفعت بالنقل — الكوكي القديم لم يعد يتحقق، فنصدر جديداً.
    const token = await createSessionToken(env, merchantId);
    return json({ ok: true, storeId: merchantId, email: accountEmail }, 200, { "Set-Cookie": sessionCookieHeader(token) });
  } catch (err) {
    if (err instanceof ClaimError) return json({ ok: false, error: err.message, code: err.code }, err.status);
    throw err;
  }
}

export const onRequestPost = withApi(claimStoreHandler);

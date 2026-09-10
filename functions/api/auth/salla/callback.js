// GET /api/auth/salla/callback — عودة تدفق OAuth بسلة (المسار اليدوي).
// المرحلة ٤: تنسيق فقط — المبادلة وحفظ التوكنات بـ`domain/salla.js`.
import { verifyOAuthState, oauthStateCookieHeader } from "../../../_lib/core/oauthState.js";
import { generateRequestId } from "../../../_lib/core/respond.js";
import { logError } from "../../../_lib/core/errorLog.js";
import { createSessionToken, sessionCookieHeader, getSessionMerchantId } from "../../../_lib/core/session.js";
import { exchangeSallaCode } from "../../../_lib/domain/salla.js";
import { SallaLinkConflictError, linkConflictMessage } from "../../../_lib/domain/sallaAccountLink.js";

const fail = (status, error, code, requestId, extraHeaders = {}) =>
  new Response(JSON.stringify({ ok: false, error, ...(code ? { code } : {}), ...(requestId ? { requestId } : {}) }), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders }
  });

export async function onRequestGet(context) {
  const { request, env } = context;
  const requestId = generateRequestId();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return fail(400, "لم يصلنا رمز التفويض من سلة. أعد بدء الربط من جديد.", "SALLA_CODE_MISSING", requestId);
  }

  // CSRF: الـstate لازم يكون من توقيعنا ومطابقاً للكوكي الذي ضُبط عند بدء
  // التدفق بهذا المتصفح. بدونه يقدر مهاجم يعيد لعب رمز تفويضه عبر متصفح الضحية
  // فيربط متجره بجلستها.
  if (!(await verifyOAuthState(env, request, url.searchParams.get("state")))) {
    return fail(400, "فشل التحقق من صحة الطلب (state). أعد بدء الربط من جديد.", null, null, {
      "Set-Cookie": oauthStateCookieHeader("", { clear: true })
    });
  }

  const clientId = env.SALLA_CLIENT_ID || env.SALLA_APP_ID;
  const clientSecret = env.SALLA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    logError(context, { requestId, path: "auth/salla/callback", code: "SALLA_CREDENTIALS_MISSING", internal: "SALLA_CLIENT_ID/SECRET not configured" });
    return fail(500, "الربط مع سلة غير مفعّل حالياً على الخادم. تواصل مع الدعم.", "SALLA_NOT_CONFIGURED", requestId);
  }

  try {
    // من هو المسجَّل دخوله الآن؟ وجودُه يجعل حسابه وجهةَ الربط بدل صفّ يُشتقّ
    // من معرّف سلة — وإلا بدّلناه لحساب آخر بصمت وتركنا حسابه فاضياً.
    const sessionMerchantId = await getSessionMerchantId(request, env).catch(() => null);

    const merchantId = await exchangeSallaCode(env, {
      code,
      redirectUri: `${url.origin}${url.pathname}`,
      clientId,
      clientSecret,
      sessionMerchantId
    });

    // جلستنا نحن (نفس نمط auth/salla_embedded.js) ثم تحويل التاجر للوحة مباشرة
    // بدل رمي JSON خام على المتصفح بعد ربط ناجح.
    const headers = new Headers({ Location: "/dashboard?connected=1", "content-type": "text/plain" });
    headers.append("Set-Cookie", sessionCookieHeader(await createSessionToken(env, merchantId)));
    headers.append("Set-Cookie", oauthStateCookieHeader("", { clear: true }));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    // تعارض ربط ليس عطلاً: المتجر مرتبط بحساب آخر. رسالة تشرح المخرج، و409
    // لا 502 — ولا نكشف أي شيء عن الصفّ الآخر (بريده أو معرّفه).
    if (error instanceof SallaLinkConflictError) {
      return fail(409, linkConflictMessage(error.reason), "SALLA_ALREADY_LINKED", requestId, {
        "Set-Cookie": oauthStateCookieHeader("", { clear: true })
      });
    }
    // `error.message` هنا نصّنا المصنَّف ("token_exchange_failed:…") لا نص سلة
    // الخام. ما يراه التاجر ثابت وعربي، والتفصيل للسجل فقط.
    logError(context, { requestId, path: "auth/salla/callback", code: "SALLA_OAUTH_FAILED", internal: error.message });
    return fail(502, "تعذر إكمال الربط مع سلة. حاول مرة ثانية، ولو تكرر تواصل معنا.", "SALLA_OAUTH_FAILED", requestId);
  }
}

// POST /api/auth/salla_embedded — body: { token }
//
// Establishes our own session for a merchant opening dashboard.html inside
// Salla's dashboard iframe. Salla Easy-Mode merchants never go through
// login.html (no email/password) — their only identity proof is the
// short-lived token the Salla Embedded SDK hands the frontend
// (embedded.auth.getToken()). We verify it server-side via Salla's own
// introspection API before trusting it; never trust a token's claims from
// the client directly.
//
// docs.salla.dev/embedded-sdk/authentication
import { withApi, json } from "../../_lib/core/respond.js";
import { getMerchantBySalla } from "../../_lib/core/db.js";
import { createSessionToken, sessionCookieHeader } from "../../_lib/core/session.js";
import { checkRateLimit } from "../../_lib/core/rateLimit.js";

const INTROSPECT_URL = "https://api.salla.dev/exchange-authority/v1/introspect";

async function sallaEmbeddedHandler(body, env, request) {
  const clientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "127.0.0.1";
  const rate = await checkRateLimit(env, clientIp, "salla_embedded_auth", 20, 60);
  if (!rate.allowed) {
    return json({ ok: false, error: "محاولات كثيرة، حاول بعد شوي." }, 429);
  }

  const token = (body?.token || "").toString();
  if (!token) {
    return json({ ok: false, error: "لا يوجد رمز جلسة من سلة." }, 400);
  }

  // Fail closed: without our own App ID we cannot pin the introspection call
  // to this app (S-Source), and must not verify against an unknown identity.
  if (!env.SALLA_APP_ID) {
    return json({ ok: false, error: "الربط مع سلة غير مضبوط حالياً." }, 503);
  }

  const introspectRes = await fetch(INTROSPECT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "S-Source": env.SALLA_APP_ID
    },
    body: JSON.stringify({ token })
  }).catch(() => null);

  const introspectData = await introspectRes?.json().catch(() => null);
  if (!introspectRes?.ok || !introspectData?.success || !introspectData?.data?.merchant_id) {
    return json({ ok: false, error: "تعذر التحقق من جلستك مع سلة.", code: "INTROSPECT_FAILED" }, 401);
  }

  const sallaMerchantId = String(introspectData.data.merchant_id);
  const account = await getMerchantBySalla(env, sallaMerchantId);
  if (!account) {
    // app.installed fired but app.store.authorize (the event that upserts the
    // merchant with tokens) hasn't landed yet — the merchant approved
    // installation but not the in-store data-access consent screen.
    return json(
      {
        ok: false,
        error: "لسه ما اكتمل ربط متجرك بالكامل — ارجع للوحة تحكم متجرك ووافق على صلاحيات التطبيق.",
        code: "MERCHANT_NOT_LINKED"
      },
      409
    );
  }

  const sessionToken = await createSessionToken(env, account.id);
  return new Response(
    JSON.stringify({ ok: true, storeId: account.id, storeName: account.store_name }),
    { status: 200, headers: { "content-type": "application/json", "Set-Cookie": sessionCookieHeader(sessionToken) } }
  );
}

export const onRequestPost = withApi(sallaEmbeddedHandler);

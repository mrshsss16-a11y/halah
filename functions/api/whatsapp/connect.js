// POST /api/whatsapp/connect — body: { code, wabaId, phoneNumberId }
//
// Server side of the one-click "ربط واتساب" button. The Embedded Signup popup
// (Meta JS SDK, dashboard.html) hands the browser a short-lived `code` plus the
// merchant's WABA and phone-number IDs; this endpoint turns that into a stored,
// per-merchant connection:
//
//   1. exchange code -> business token   (server-to-server ONLY, needs app secret)
//   2. subscribe our app to webhooks on THEIR WABA
//   3. persist so webhook.js can route their customers' messages back to them
//
// Docs: developers.facebook.com/documentation/business-messaging/whatsapp/
//       embedded-signup/onboarding-customers-as-a-tech-provider
//
// STATUS: code-complete and wired end-to-end (dashboard button -> this
// endpoint -> D1 -> webhook.js routing), but INTENTIONALLY inert in
// production right now — not forgotten. Meta only shows the "WhatsApp
// Embedded Signup" login variation (and thus a usable WA_SIGNUP_CONFIG_ID)
// after this app is approved as a Tech Provider (App Review submitted,
// pending as of this writing). Until then env.WA_SIGNUP_CONFIG_ID stays
// unset, status.js reports `available: false`, and the dashboard button
// stays disabled with an explanatory note instead of calling FB.login().
// The moment Tech Provider approval lands and an operator sets
// WA_SIGNUP_CONFIG_ID (+ the already-present META_APP_ID/WHATSAPP_APP_SECRET),
// this activates with no code changes.
import { withApi, json, ApiError } from "../../_lib/core/respond.js";
import { requireCompletedAccount } from "../../_lib/core/session.js";
import { saveWaConnection, getWaConnectionByPhoneId } from "../../_lib/core/db.js";
import { checkRateLimit } from "../../_lib/core/rateLimit.js";
import { syncCoexistenceHistory } from "../../_lib/integrations/whatsapp.js";
import { logError } from "../../_lib/core/errorLog.js";

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Embedded Signup and the WhatsApp webhook belong to the SAME Meta app, so the
 * app secret is the same value already stored as WHATSAPP_APP_SECRET. Accept
 * either name rather than making the operator store the secret twice.
 */
function metaAppSecret(env) {
  return env.META_APP_SECRET || env.WHATSAPP_APP_SECRET || null;
}

async function exchangeCodeForToken(env, code) {
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("client_id", env.META_APP_ID);
  url.searchParams.set("client_secret", metaAppSecret(env));
  url.searchParams.set("code", code);

  const res = await fetch(url.toString());
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    throw new ApiError(502, "تعذر إكمال الربط مع واتساب. حاول مرة ثانية.", "TOKEN_EXCHANGE_FAILED");
  }
  return data.access_token;
}

/** Without this, none of the merchant's customer messages ever reach us. */
async function subscribeToWaba(wabaId, businessToken) {
  const res = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${businessToken}` }
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.success !== true) {
    throw new ApiError(502, "تم الربط لكن تعذر تفعيل استقبال الرسائل. تواصل معنا.", "WEBHOOK_SUBSCRIBE_FAILED");
  }
}

/** Display name + number, so the dashboard can show what got connected. */
async function fetchPhoneDetails(phoneNumberId, businessToken) {
  const res = await fetch(`${GRAPH}/${phoneNumberId}?fields=display_phone_number,verified_name`, {
    headers: { Authorization: `Bearer ${businessToken}` }
  });
  if (!res.ok) return {};
  return (await res.json().catch(() => ({}))) || {};
}

async function connectHandler(body, env, request, requestId, context) {
  // A real logged-in merchant WITH a completed account only. resolveStoreId()
  // would fall back to the shared "default-store" pseudo-tenant for anonymous
  // callers, which here would let a stranger bind a WhatsApp number to it; and
  // binding an external channel is a "real operation", so a Salla session with
  // no `accounts` row gets 403 ACCOUNT_REQUIRED (see requireCompletedAccount).
  const merchantId = await requireCompletedAccount(request, env, body?.storeId);

  const clientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "127.0.0.1";
  const rate = await checkRateLimit(env, clientIp, "wa_connect", 5, 300);
  if (!rate.allowed) {
    return json({ ok: false, error: `محاولات كثيرة. حاول بعد ${rate.resetInSeconds} ثانية.` }, 429);
  }

  // Fail closed: without the app secret we cannot exchange the code at all, and
  // must never fall back to a shared/default credential.
  if (!env.META_APP_ID || !metaAppSecret(env)) {
    return json({ ok: false, error: "ربط واتساب غير مفعّل حالياً.", code: "NOT_CONFIGURED" }, 503);
  }

  const code = (body?.code || "").toString();
  const wabaId = (body?.wabaId || "").toString().replace(/[^\d]/g, "");
  const phoneNumberId = (body?.phoneNumberId || "").toString().replace(/[^\d]/g, "");

  if (!code || !wabaId || !phoneNumberId) {
    return json({ ok: false, error: "بيانات الربط ناقصة." }, 400);
  }

  // A phone number belongs to exactly one merchant. Without this check, merchant
  // B could claim a number already connected by merchant A and start receiving
  // A's customer conversations.
  const existing = await getWaConnectionByPhoneId(env, phoneNumberId);
  if (existing && existing.merchant_id !== merchantId) {
    return json({ ok: false, error: "هذا الرقم مربوط بحساب آخر.", code: "NUMBER_TAKEN" }, 409);
  }

  const businessToken = await exchangeCodeForToken(env, code);
  await subscribeToWaba(wabaId, businessToken);
  const details = await fetchPhoneDetails(phoneNumberId, businessToken);

  await saveWaConnection(env, {
    merchantId,
    wabaId,
    phoneNumberId,
    businessToken,
    displayPhone: details.display_phone_number || null,
    verifiedName: details.verified_name || null
  });

  // Coexistence: pull the merchant's existing contacts + chat history within
  // Meta's ~24h window. Best-effort and must never block/slow the response —
  // the merchant is waiting on this request to see "متصل".
  if (context?.waitUntil) {
    context.waitUntil(
      syncCoexistenceHistory(wabaId, businessToken).catch((err) =>
        logError(context, {
          requestId,
          path: "/api/whatsapp/connect#coexistence-sync",
          code: "WA_COEXISTENCE_SYNC_FAILED",
          internal: err?.message,
          storeId: merchantId
        })
      )
    );
  }

  // Never return the token to the browser.
  return json({
    ok: true,
    displayPhone: details.display_phone_number || null,
    verifiedName: details.verified_name || null
  });
}

export const onRequestPost = withApi(connectHandler);

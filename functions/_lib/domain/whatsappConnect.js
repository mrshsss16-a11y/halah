// مجال ربط رقم واتساب للتاجر (Embedded Signup) — نُقل من
// `api/whatsapp/connect.js` بالمرحلة ٤ (ARCHITECTURE §١) بلا تغيير سلوكي.
//
//   1. exchange code -> business token   (server-to-server ONLY, needs app secret)
//   2. subscribe our app to webhooks on THEIR WABA
//   3. persist so the inbound webhook can route their customers' messages back
//
// Docs: developers.facebook.com/documentation/business-messaging/whatsapp/
//       embedded-signup/onboarding-customers-as-a-tech-provider
//
// يرمي `DomainError` لا `ApiError` (ق٣) — و`withApi` يترجمه بنفس الحالة.
import { DomainError } from "../core/errors.js";
import { syncCoexistenceHistory } from "../integrations/whatsapp.js";
import { logError } from "../core/errorLog.js";
import { saveWaConnection, getWaConnectionByPhoneId } from "./whatsapp.js";

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Embedded Signup and the WhatsApp webhook belong to the SAME Meta app, so the
 * app secret is the same value already stored as WHATSAPP_APP_SECRET. Accept
 * either name rather than making the operator store the secret twice.
 */
export function metaAppSecret(env) {
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
    throw new DomainError(502, "تعذر إكمال الربط مع واتساب. حاول مرة ثانية.", "TOKEN_EXCHANGE_FAILED");
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
    throw new DomainError(502, "تم الربط لكن تعذر تفعيل استقبال الرسائل. تواصل معنا.", "WEBHOOK_SUBSCRIBE_FAILED");
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

/**
 * A phone number belongs to exactly one merchant. Without this check, merchant
 * B could claim a number already connected by merchant A and start receiving
 * A's customer conversations.
 */
export async function assertPhoneNotTaken(env, phoneNumberId, merchantId) {
  const existing = await getWaConnectionByPhoneId(env, phoneNumberId);
  return !(existing && existing.merchant_id !== merchantId);
}

/** يرجّع بيانات العرض فقط — التوكن لا يغادر الخادم إطلاقاً. */
export async function connectWhatsappNumber(env, { merchantId, code, wabaId, phoneNumberId, context, requestId }) {
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

  return { displayPhone: details.display_phone_number || null, verifiedName: details.verified_name || null };
}

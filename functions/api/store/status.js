// POST /api/store/status — body: { storeId? , sallaMerchantId? }
// Used by onboarding.html to poll whether the app.store.authorize webhook
// has landed after the merchant installs the app from the Salla store.
// Returns the canonical merchant id so the frontend can persist hala_store_id.
import { withApi } from "../../_lib/core/respond.js";
import { getMerchant, getMerchantBySalla, getTokens, getPlatformConnection, getAccountEmail } from "../../_lib/core/db.js";
import { getSessionMerchantId } from "../../_lib/core/session.js";

async function statusHandler(body, env, request) {
  let merchant = null;
  const sessionMerchantId = await getSessionMerchantId(request, env);
  if (sessionMerchantId) {
    merchant = await getMerchant(env, sessionMerchantId);
  }
  if (!merchant && body.storeId) {
    merchant = await getMerchant(env, String(body.storeId));
  }
  if (!merchant && body.sallaMerchantId) {
    merchant = await getMerchantBySalla(env, String(body.sallaMerchantId));
  }
  // NOTE: there used to be a "latest merchant created in the last 5 minutes"
  // fallback here for the post-install polling window. It was an unauthenticated
  // cross-tenant leak (SECURITY_AUDIT C4): an attacker polling with an empty
  // body harvested the m_ id of every fresh Salla install, which chains through
  // resolveStoreId into /api/store/overview (customer PII), /publish and /bulk.
  // Removed 2026-09-05 — onboarding must carry the storeId from the Salla
  // redirect (it already receives it) instead of guessing "whoever installed
  // most recently".
  if (!merchant) {
    return { linked: false };
  }

  // Tenant isolation: a merchant that has an account is only visible to its
  // own session. Without this, probing storeId/sallaMerchantId (or racing the
  // 5-minute install fallback) leaks a registered merchant's id, store name
  // and connection state to anyone — the first link in the IDOR chain.
  if (merchant.id !== sessionMerchantId && (await getAccountEmail(env, merchant.id))) {
    return { linked: false, code: "LOGIN_REQUIRED" };
  }

  const sallaTokens = await getTokens(env, merchant.id, "salla");
  const trendyol = await getPlatformConnection(env, merchant.id, "trendyol");

  return {
    linked: Boolean(sallaTokens || trendyol),
    storeId: merchant.id,
    storeName: merchant.store_name,
    salla: Boolean(sallaTokens),
    trendyol: Boolean(trendyol)
  };
}

export const onRequestPost = withApi(statusHandler);

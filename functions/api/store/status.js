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
  if (!merchant) {
    // Right-after-install polling window only (onboarding polls with an
    // empty body immediately after the Salla redirect, before it knows its
    // own storeId). Bounded to the last 5 minutes so this can't be used to
    // fetch an arbitrary merchant's storeId/connection status at any time —
    // the previous unbounded "latest merchant" lookup was exactly that leak.
    merchant = await env.DB.prepare(
      "SELECT * FROM merchants WHERE created_at > datetime('now', '-5 minutes') ORDER BY created_at DESC LIMIT 1"
    ).first();
  }
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

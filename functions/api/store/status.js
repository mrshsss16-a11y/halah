// POST /api/store/status — body: { storeId? , sallaMerchantId? }
// Used by onboarding.html to poll whether the app.store.authorize webhook
// has landed after the merchant installs the app from the Salla store.
// Returns the canonical merchant id so the frontend can persist hala_store_id.
import { withApi } from "../../_lib/respond.js";
import { getMerchant, getMerchantBySalla, getTokens, getPlatformConnection } from "../../_lib/db.js";

async function statusHandler(body, env) {
  let merchant = null;
  if (body.storeId) {
    merchant = await getMerchant(env, String(body.storeId));
  }
  if (!merchant && body.sallaMerchantId) {
    merchant = await getMerchantBySalla(env, String(body.sallaMerchantId));
  }
  if (!merchant) {
    // Cheap "latest linked merchant" path for the single-tenant demo flow:
    // onboarding polls right after install, no id known yet.
    merchant = await env.DB.prepare("SELECT * FROM merchants ORDER BY created_at DESC LIMIT 1").first();
  }
  if (!merchant) {
    return { linked: false };
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

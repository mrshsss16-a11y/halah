// POST /api/auth/me — current session status. Any page can call this once on
// load to decide whether to show "مرحباً <email>" or an anonymous-demo banner.
import { withApi, json } from "../../_lib/core/respond.js";
import { getSessionMerchantId, requireAdmin } from "../../_lib/core/session.js";
import { getAccountEmail, getStoreName } from "../../_lib/domain/accounts.js";
import { getUsage } from "../../_lib/core/meter.js";

async function meHandler(body, env, request) {
  const merchantId = await getSessionMerchantId(request, env);
  if (!merchantId) return json({ loggedIn: false });

  const [admin, email, storeName, usage] = await Promise.all([
    requireAdmin(request, env),
    getAccountEmail(env, merchantId),
    getStoreName(env, merchantId),
    getUsage(env, merchantId)
  ]);

  return json({
    loggedIn: true,
    storeId: merchantId,
    email: email ?? undefined,
    storeName: storeName ?? "متجري الذكي",
    isAdmin: Boolean(admin),
    usage
  });
}

export const onRequestPost = withApi(meHandler);

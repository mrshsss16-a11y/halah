// POST /api/auth/me — current session status. Any page can call this once on
// load to decide whether to show "مرحباً <email>" or an anonymous-demo banner.
import { json } from "../../_lib/core/respond.js";
import { getSessionMerchantId, requireAdmin } from "../../_lib/core/session.js";
import { getUsage } from "../../_lib/core/meter.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const merchantId = await getSessionMerchantId(request, env);
  if (!merchantId) {
    return json({ loggedIn: false });
  }

  const admin = await requireAdmin(request, env);
  const [account, merchant, usage] = await Promise.all([
    env.DB.prepare("SELECT email FROM accounts WHERE merchant_id = ?").bind(merchantId).first(),
    env.DB.prepare("SELECT store_name FROM merchants WHERE id = ?").bind(merchantId).first(),
    getUsage(env, merchantId)
  ]);

  return json({
    loggedIn: true,
    storeId: merchantId,
    email: account?.email,
    storeName: merchant?.store_name ?? "متجري الذكي",
    isAdmin: Boolean(admin),
    usage
  });
}

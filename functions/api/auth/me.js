// POST /api/auth/me — current session status. Any page can call this once on
// load to decide whether to show "مرحباً <email>" or an anonymous-demo banner.
import { json } from "../../_lib/respond.js";
import { getSessionMerchantId } from "../../_lib/session.js";
import { getUsage } from "../../_lib/meter.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const merchantId = await getSessionMerchantId(request, env);
  if (!merchantId) {
    return json({ loggedIn: false });
  }

  const [account, merchant, usage] = await Promise.all([
    env.DB.prepare("SELECT email FROM accounts WHERE merchant_id = ?").bind(merchantId).first(),
    env.DB.prepare("SELECT store_name FROM merchants WHERE id = ?").bind(merchantId).first(),
    getUsage(env, merchantId)
  ]);

  return json({
    loggedIn: true,
    storeId: merchantId,
    email: account && account.email,
    storeName: merchant && merchant.store_name,
    usage
  });
}

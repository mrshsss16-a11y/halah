// POST /api/usage — body: { storeId }
// Returns today's remaining free credits so studio.html's credit bar shows a
// real number instead of the old hardcoded "34 / 50".
import { withApi } from "../_lib/respond.js";
import { getUsage } from "../_lib/meter.js";

async function usageHandler(body, env) {
  const merchantId = (body.storeId || "default-store").toString().slice(0, 40);
  const usage = await getUsage(env, merchantId);
  return { ok: true, ...usage };
}

export const onRequestPost = withApi(usageHandler);

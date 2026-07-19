// POST /api/usage — body: { storeId }
// Returns today's remaining free credits so studio.html's credit bar shows a
// real number instead of the old hardcoded "34 / 50".
import { withApi } from "../_lib/respond.js";
import { getUsage } from "../_lib/meter.js";
import { resolveStoreId } from "../_lib/session.js";

async function usageHandler(body, env, request) {
  // Same tenant-isolation rule as every other store endpoint — without it,
  // any storeId's daily usage numbers were readable anonymously.
  const merchantId = await resolveStoreId(request, env, body.storeId);
  const usage = await getUsage(env, merchantId);
  return { ok: true, ...usage };
}

export const onRequestPost = withApi(usageHandler);

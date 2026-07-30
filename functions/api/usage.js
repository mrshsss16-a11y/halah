// POST /api/usage — body: { storeId }
// Returns today's remaining free credits so studio.html's credit bar shows a
// real number instead of the old hardcoded "34 / 50".
import { withApi } from "../_lib/core/respond.js";
import { getUsage } from "../_lib/core/meter.js";
import { resolveStoreId } from "../_lib/core/session.js";

async function usageHandler(body, env, request) {
  // Same tenant-isolation rule as every other store endpoint — without it,
  // any storeId's daily usage numbers were readable anonymously.
  const merchantId = await resolveStoreId(request, env, body?.storeId);
  const usage = await getUsage(env, merchantId);
  
  const tokensConsumed = usage?.used ?? 0;
  const estimatedSavingsSar = tokensConsumed * 1.5;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const timestampKSA = formatter.format(new Date());

  return { 
    ok: true, 
    ...(usage ?? {}),
    tokensConsumed,
    estimatedSavingsSar,
    timestampKSA,
    savingRate: "50%"
  };
}

export const onRequestPost = withApi(usageHandler);

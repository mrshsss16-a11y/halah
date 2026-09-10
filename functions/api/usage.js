// POST /api/usage — body: { storeId }
// Returns the merchant's real remaining monthly quota so the dashboard shows
// real numbers instead of a placeholder. اللوحة تعرض دلو `description` وحده:
// `image` يُستهلك بتوليد الصور من الأدمن فقط لا بتحليل صورة المنتج، و`message`
// بلا سطح صرف منذ إزالة تبويب الوكيل (2026-09-10).
import { withApi } from "../_lib/core/respond.js";
import { getMonthlyUsage } from "../_lib/core/meter.js";
import { resolveStoreId } from "../_lib/core/session.js";

async function usageHandler(body, env, request) {
  // Same tenant-isolation rule as every other store endpoint — without it,
  // any storeId's usage numbers were readable anonymously.
  // store-gate-ok: قراءة الحصة فقط — التاجر يشوف رصيده قبل إكمال الحساب (بلا كتابة ولا استهلاك AI)
  const merchantId = await resolveStoreId(request, env, body?.storeId);
  const monthly = await getMonthlyUsage(env, merchantId);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

  return {
    ok: true,
    description: monthly.description,
    message: monthly.message,
    // Back-compat shape for existing callers reading a single {used,remaining,limit} —
    // "message" is the closer analogue to the old blended daily credit pool.
    used: monthly.message.used,
    remaining: monthly.message.remaining,
    limit: monthly.message.limit,
    timestampKSA: formatter.format(new Date())
  };
}

export const onRequestPost = withApi(usageHandler);

// POST /api/store/catalog/sync — body: { storeId }
// المرحلة ١ من docs/PLAN_BULK_SEO.md: يبدأ وظيفة سحب كتالوج المتجر من سلة إلى
// D1 (kind='catalog_sync'). الوظيفة نفسها تُصرَّف بـfunctions/api/cron/bulk_process.js
// **صفحة واحدة لكل تِك** — تجاوز حد سلة (١ طلب/ثانية لكل متجر) يوقف اتصال
// المتجر كاملاً لا الطلب وحده، فلا سحب داخل هذا الطلب إطلاقاً.
import { withApi } from "../../../_lib/core/respond.js";
import { requireCompletedAccount } from "../../../_lib/core/session.js";
import { getActiveJobByKind, createCatalogSyncJob } from "../../../_lib/core/db.js";
import { countCatalog } from "../../../_lib/services/catalog.js";
import { checkRateLimit, clientIp } from "../../../_lib/core/rateLimit.js";

async function catalogSyncHandler(body, env, request) {
  // السحب يولّد طلبات سلة على متجر التاجر — سقف صارم على إنشاء الوظائف.
  const rl = await checkRateLimit(env, clientIp(request), "catalog_sync", 3, 300);
  if (!rl.allowed) {
    return { ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" };
  }

  const merchantId = await requireCompletedAccount(request, env, body.storeId);

  // وظيفة ثانية لنفس التاجر = مضاعفة معدل الطلبات على سلة ⇒ خطر إيقاف الاتصال.
  const active = await getActiveJobByKind(env, merchantId, "catalog_sync");
  if (active) {
    return {
      ok: false,
      error: "فيه سحب شغّال لمتجرك الحين — انتظر لين يخلص.",
      code: "SYNC_ALREADY_RUNNING",
      jobId: active.id
    };
  }

  const jobId = `sync_${crypto.randomUUID().slice(0, 12)}`;
  await createCatalogSyncJob(env, { id: jobId, merchantId });

  return {
    ok: true,
    jobId,
    alreadyInCatalog: await countCatalog(env, { merchantId }),
    // تِك كل ١٠ دقائق × صفحة (٦٠ منتج) — توقّع صادق لا وعد بالفورية.
    message: "بدأ سحب منتجات متجرك. يتم سحب صفحة كل عشر دقائق حتى يكتمل الكتالوج."
  };
}

export const onRequestPost = withApi(catalogSyncHandler);

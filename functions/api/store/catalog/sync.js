// POST /api/store/catalog/sync — body: { storeId }
// المرحلة ١ من docs/PLAN_BULK_SEO.md: يسحب **الصفحة الأولى فوراً** ثم يترك
// الصفحات الباقية لوظيفة (kind='catalog_sync') يصرّفها cron/bulk_process.js.
//
// المرحلة ٤: تنسيق فقط — منطق السحب والنص بـ`domain/catalogSync.js`.
import { withApi } from "../../../_lib/core/respond.js";
import { requireCompletedAccount } from "../../../_lib/core/session.js";
import { getActiveJobByKind } from "../../../_lib/domain/bulk.js";
import { countCatalog } from "../../../_lib/domain/catalog.js";
import { syncFirstPage, syncMessage } from "../../../_lib/domain/catalogSync.js";
import { checkRateLimit, clientIp } from "../../../_lib/core/rateLimit.js";
import { logError } from "../../../_lib/core/errorLog.js";

async function catalogSyncHandler(body, env, request, requestId, context) {
  // السحب يولّد طلبات سلة على متجر التاجر — سقف صارم على بدء السحب.
  const rl = await checkRateLimit(env, clientIp(request), "catalog_sync", 3, 300);
  if (!rl.allowed) return { ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" };

  const merchantId = await requireCompletedAccount(request, env, body.storeId);

  // وظيفة ثانية لنفس التاجر = مضاعفة معدل الطلبات على سلة ⇒ خطر إيقاف الاتصال.
  const active = await getActiveJobByKind(env, merchantId, "catalog_sync");
  if (active) {
    return { ok: false, error: "فيه سحب شغّال لمتجرك الحين — انتظر لين يخلص.", code: "SYNC_ALREADY_RUNNING", jobId: active.id };
  }

  let result;
  try {
    result = await syncFirstPage(env, merchantId);
  } catch (err) {
    logError(context, {
      requestId, path: "store/catalog/sync", code: "CATALOG_FIRST_PAGE_FAILED",
      storeId: merchantId, internal: String((err && err.message) || err).slice(0, 250)
    });
    return {
      ok: false,
      error: "ما قدرنا نوصل لمنتجاتك بسلة الحين. تأكد أن متجرك مربوط وجرّب بعد دقيقة.",
      code: "CATALOG_SYNC_FAILED"
    };
  }

  return {
    ok: true,
    jobId: result.jobId,
    imported: result.imported,
    hasMore: result.hasMore,
    skippedNoSku: result.skippedNoSku,
    alreadyInCatalog: await countCatalog(env, { merchantId }),
    message: syncMessage(result)
  };
}

export const onRequestPost = withApi(catalogSyncHandler);

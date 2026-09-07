// POST /api/store/catalog/sync — body: { storeId }
// المرحلة ١ من docs/PLAN_BULK_SEO.md: يسحب **الصفحة الأولى فوراً** ثم يترك
// الصفحات الباقية لوظيفة (kind='catalog_sync') يصرّفها functions/api/cron/bulk_process.js.
//
// لماذا صفحة واحدة متزامنة هنا؟ حد سلة ١ طلب/ثانية لكل متجر، وتجاوزه يوقف
// اتصال المتجر **كاملاً** لا الطلب وحده. طلب واحد عند ضغطة زر يقع تحت الحد
// بأمان — والحلقة هي الممنوعة، لا الطلب الأول. المكسب: التاجر يشوف منتجاته
// فوراً بدل شاشة فارغة تنتظر تِك الـcron.
import { withApi } from "../../../_lib/core/respond.js";
import { requireCompletedAccount } from "../../../_lib/core/session.js";
import {
  getActiveJobByKind,
  createCatalogSyncJob,
  advanceCatalogSyncJob
} from "../../../_lib/core/db.js";
import { countCatalog, syncCatalogPage } from "../../../_lib/services/catalog.js";
import { checkRateLimit, clientIp } from "../../../_lib/core/rateLimit.js";
import { logError } from "../../../_lib/core/errorLog.js";

/**
 * الصفحة الأولى + إنشاء الوظيفة للباقي.
 *
 * ترتيب الخطوات متعمَّد: **السحب أولاً ثم إنشاء الوظيفة**. لو فشلت الصفحة
 * الأولى لا تُنشأ وظيفة إطلاقاً، فلا يبقى شيء "شغّال" يوهم التاجر بنجاح
 * ولا يحجز حارس SYNC_ALREADY_RUNNING متجره بلا داعٍ.
 *
 * `syncPage` منفذ حقن للاختبار فقط (الافتراضي syncCatalogPage الحقيقية) —
 * يسمح بعدّ استدعاءات سلة بلا شبكة ولا توكنات.
 *
 * @returns {Promise<{imported:number, hasMore:boolean, skippedNoSku:number, jobId:string|null}>}
 */
export async function syncFirstPage(env, merchantId, { syncPage = syncCatalogPage } = {}) {
  // **استدعاء واحد لا حلقة** — الصفحة ١ فقط. الباقي للـcron (تِك/صفحة).
  const first = await syncPage(env, { merchantId, page: 1 });

  // متجر صغير خلص بصفحة واحدة: لا وظيفة معلّقة تنتظر تِكاً بلا شغل.
  if (!first.hasMore) {
    return {
      imported: first.imported,
      hasMore: false,
      skippedNoSku: first.skippedNoSku,
      jobId: null
    };
  }

  const jobId = `sync_${crypto.randomUUID().slice(0, 12)}`;
  await createCatalogSyncJob(env, { id: jobId, merchantId });
  // createCatalogSyncJob يبدأ الـcursor عند '1'؛ الصفحة ١ مسحوبة أصلاً فوق،
  // فنقدّمه للصفحة التالية ونسجّل ما استوردناه حتى لا يُعاد سحبها بأول تِك.
  await advanceCatalogSyncJob(env, {
    jobId,
    imported: first.imported,
    nextPage: first.nextPage
  });

  return {
    imported: first.imported,
    hasMore: true,
    skippedNoSku: first.skippedNoSku,
    jobId
  };
}

/** نص صادق: لا وعد بفورية غير متحققة، ولا إخفاء انتظار حقيقي. */
function syncMessage({ imported, hasMore, skippedNoSku }) {
  if (hasMore) {
    return `سحبنا أول ${imported} منتجاً — الباقي يوصل خلال دقائق.`;
  }
  if (imported > 0) {
    const tail = skippedNoSku > 0 ? ` (${skippedNoSku} منتجاً بلا رمز SKU ما قدرنا نحفظه)` : "";
    return `تم سحب ${imported} منتجاً ✅${tail}`;
  }
  if (skippedNoSku > 0) {
    return `ما قدرنا نحفظ أي منتج: ${skippedNoSku} منتجاً بلا رمز SKU. أضف رموز SKU بسلة ثم أعد المحاولة.`;
  }
  return "ما لقينا منتجات بمتجرك على سلة.";
}

async function catalogSyncHandler(body, env, request, requestId, context) {
  // السحب يولّد طلبات سلة على متجر التاجر — سقف صارم على بدء السحب.
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

  let result;
  try {
    result = await syncFirstPage(env, merchantId);
  } catch (err) {
    logError(context, {
      requestId,
      path: "store/catalog/sync",
      code: "CATALOG_FIRST_PAGE_FAILED",
      storeId: merchantId,
      internal: String((err && err.message) || err).slice(0, 250)
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

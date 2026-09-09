// GET /api/cron/bulk_process — طابور الجملة، يُضرب كل ١٠ دقائق من cron-worker/index.js.
//
// ثلاث مراحل بطابور واحد (docs/PLAN_BULK_SEO.md §٣ + المرحلة ٢ بـdocs/COMPLETION_PATH.md):
//
//   ① catalog_sync   صفحة واحدة من كتالوج سلة لكل تِك (حد سلة ١ طلب/ثانية لكل متجر).
//   ② seo_generate   توليد AI فقط — **صفر كتابة على سلة**. كل مخرج يدخل
//                    review_queue بحالة pending (kind='description'). هذا هو
//                    الفصل الذي يجعل "الـAI يقترح والإنسان يقرر" حقيقياً على
//                    أوسع مسار بالمنتج، لا شعاراً.
//   ③ seo_publish    المعتمَد فقط، **متجر واحد لكل تِك**، فاصل ≥ ١.١ث بين
//                    كل كتابة، توقف فوري عند ٤٢٩. النشر يمر حصراً عبر
//                    services/publishApproved.js (المكان الوحيد لإرسال مخرج AI
//                    لمنصة خارجية).
//
// لماذا فُصل التوليد عن النشر: نداء AI لا علاقة له بحد سلة؛ دمجهما كان يورّث
// التوليد قيد ١/ثانية بلا سبب (٢٠٠ منتج = ٣.٤ ساعة بدل دقائق). الآن التوليد
// يمشي بسرعة النموذج، والنشر بسرعة سلة، وكل منهما لا يعطّل الآخر.
import { generateProductCopy } from "../copy.js";
import { timingSafeEqualStr } from "../../_lib/core/crypto.js";
import {
  listActiveBulkJobItems,
  completeBulkJobItem,
  claimNextCatalogSyncJob,
  advanceCatalogSyncJob,
  failCatalogSyncJob,
  listMerchantsWithDeferredItems,
  reviveDeferredItems
} from "../../_lib/core/db.js";
import { syncCatalogPage, getCatalogItem } from "../../_lib/services/catalog.js";
import { enqueue, claimNextPublishMerchant, listApprovedUnpublished } from "../../_lib/services/reviewQueue.js";
import { publishApproved } from "../../_lib/services/publishApproved.js";
import { checkAndConsumeMonthly, getMonthlyUsage } from "../../_lib/core/meter.js";
import { generateRequestId } from "../../_lib/core/respond.js";
import { logError } from "../../_lib/core/errorLog.js";
import { recordHeartbeat } from "../../_lib/core/heartbeat.js";

const GENERATE_BATCH = 20; // نداءات AI فقط — لا فاصل سلة بينها
const PUBLISH_BATCH = 20; // ~22s عند ١.١ث/كتابة — داخل استدعاء Worker واحد
const SALLA_DELAY_MS = 1100; // > حد سلة ١ طلب/ثانية

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function unauthorized(requestId) {
  return new Response(JSON.stringify({ ok: false, error: "غير مصرّح بهذا الطلب.", code: "UNAUTHORIZED", requestId }), {
    status: 401,
    headers: { "content-type": "application/json" }
  });
}

function notConfigured(requestId) {
  return new Response(JSON.stringify({ ok: false, error: "معالجة الدفعات غير مفعّلة حالياً على الخادم.", code: "CRON_NOT_CONFIGURED", requestId }), {
    status: 500,
    headers: { "content-type": "application/json" }
  });
}

// ① سحب صفحة كتالوج واحدة.
async function tickCatalogSync(context, env, requestId) {
  const syncJob = await claimNextCatalogSyncJob(env).catch(() => null);
  if (!syncJob) return null;
  try {
    const page = Number(syncJob.cursor) > 0 ? Number(syncJob.cursor) : 1;
    const result = await syncCatalogPage(env, { merchantId: syncJob.merchant_id, page });
    await advanceCatalogSyncJob(env, { jobId: syncJob.id, imported: result.imported, nextPage: result.nextPage });
    if (result.skippedNoSku > 0) {
      // لا إسقاط صامت: المنتجات بلا SKU لا يمكن تخزينها (المفتاح يتطلبه).
      logError(context, {
        requestId,
        path: "cron/bulk_process",
        code: "CATALOG_ITEMS_WITHOUT_SKU",
        storeId: syncJob.merchant_id,
        internal: `job=${syncJob.id} page=${page} skippedNoSku=${result.skippedNoSku}`
      });
    }
    return { jobId: syncJob.id, page, imported: result.imported, skippedNoSku: result.skippedNoSku, hasMore: result.hasMore };
  } catch (err) {
    logError(context, {
      requestId,
      path: "cron/bulk_process",
      code: "CATALOG_SYNC_FAILED",
      storeId: syncJob.merchant_id,
      internal: `job=${syncJob.id} ${String((err && err.message) || err).slice(0, 250)}`
    });
    await failCatalogSyncJob(env, syncJob.id).catch(() => {});
    return { jobId: syncJob.id, failed: true };
  }
}

// إحياء المؤجَّل: متجر تجدّدت حصته يستعيد صفوفه المقصوصة بلا أي فعل منه.
async function tickReviveDeferred(context, env, requestId) {
  let revived = 0;
  const merchants = await listMerchantsWithDeferredItems(env).catch(() => []);
  for (const m of merchants) {
    try {
      const usage = await getMonthlyUsage(env, m.merchant_id);
      const remaining = Number(usage?.description?.remaining || 0);
      if (remaining <= 0) continue;
      revived += await reviveDeferredItems(env, { merchantId: m.merchant_id, limit: Math.min(remaining, Number(m.deferred) || 0) });
    } catch (err) {
      logError(context, { requestId, path: "cron/bulk_process", code: "DEFERRED_REVIVE_FAILED", storeId: m.merchant_id, internal: String(err?.message || err).slice(0, 250) });
    }
  }
  return revived;
}

/** الحمولة التي يراها التاجر بشاشة المراجعة ثم تُنشر حرفياً بعد اعتماده. */
function buildDescriptionPayload({ item, parsed, catalogRow }) {
  return {
    source: "bulk",
    jobId: item.job_id,
    itemId: item.id,
    sku: item.sku,
    name: item.name,
    price: item.price || null,
    category: item.category || null,
    imageUrl: catalogRow?.image_url || null,
    currentDescription: catalogRow?.current_description || null,
    description: String(parsed?.copywriting?.description || "").trim().slice(0, 5000),
    seo: parsed?.seo || null,
    copywriting: parsed?.copywriting || null,
    faqs: Array.isArray(parsed?.faqs) ? parsed.faqs.slice(0, 5) : [],
    generatedAt: new Date().toISOString()
  };
}

// ② توليد → بوابة المراجعة. لا استيراد لسلة هنا إطلاقاً (اختبار BULK-1 يحرس ذلك).
async function tickGenerate(context, env, requestId) {
  const items = await listActiveBulkJobItems(env, GENERATE_BATCH);
  let queuedForReview = 0;
  let failed = 0;

  for (const item of items) {
    try {
      const usage = await checkAndConsumeMonthly(env, item.merchant_id, "description");
      if (!usage.ok) {
        await completeBulkJobItem(env, { itemId: item.id, jobId: item.job_id, status: "skipped", error: "الحصة الشهرية خلصت" });
        failed++;
        continue;
      }

      // بيانات الكتالوج (إن سُحب): الصورة والوصف الحالي يرفعان جودة التوليد
      // ويظهران بشاشة المراجعة "الحالي ← المقترح". غيابها = مسار CSV اليدوي.
      const catalogRow = await getCatalogItem(env, { merchantId: item.merchant_id, sku: item.sku }).catch(() => null);

      const parsed = await generateProductCopy({
        env,
        merchantId: item.merchant_id,
        name: item.name,
        price: item.price,
        tone: item.tone,
        category: item.category,
        features: "",
        existingDescription: catalogRow?.current_description || "",
        imageUrl: catalogRow?.image_url || ""
      });

      const payload = buildDescriptionPayload({ item, parsed, catalogRow });
      if (!payload.description) throw new Error("empty description from generator");

      const review = await enqueue(env, { merchantId: item.merchant_id, kind: "description", payload });

      await completeBulkJobItem(env, {
        itemId: item.id,
        jobId: item.job_id,
        status: "done",
        description: payload.description,
        seoPayload: JSON.stringify({ seo: payload.seo, copywriting: payload.copywriting }),
        reviewId: review?.id ?? null
      });
      queuedForReview++;
    } catch (err) {
      // العمود merchant-facing (يظهر بقائمة الفاشل بالداشبورد) — العربي له،
      // والتفاصيل (مزوّد AI، معرّفات) لسجل الأخطاء.
      logError(context, {
        requestId,
        path: "cron/bulk_process",
        code: "BULK_ITEM_FAILED",
        storeId: item.merchant_id,
        internal: `item=${item.id} ${String((err && err.message) || err).slice(0, 250)}`
      });
      await completeBulkJobItem(env, { itemId: item.id, jobId: item.job_id, status: "failed", error: "تعذّرت معالجة هذا الصف. جرّبه مرة ثانية." });
      failed++;
    }
  }

  return { picked: items.length, queuedForReview, failed };
}

// ③ نشر المعتمَد — متجر واحد لكل تِك.
async function tickPublish(context, env, requestId) {
  const merchantId = await claimNextPublishMerchant(env, { kind: "description" }).catch(() => null);
  if (!merchantId) return null;

  const rows = await listApprovedUnpublished(env, { merchantId, kind: "description", limit: PUBLISH_BATCH });
  let published = 0;
  let failed = 0;
  let stoppedByRateLimit = false;

  for (const row of rows) {
    const result = await publishApproved(env, row);
    if (result.published) {
      published++;
    } else {
      failed++;
      logError(context, {
        requestId,
        path: "cron/bulk_process",
        code: "SEO_PUBLISH_FAILED",
        storeId: merchantId,
        internal: `review=${row.id} ${String(result.error || "").slice(0, 250)}`
      });
      if (result.retryAfter) {
        // ٤٢٩ من سلة: أي طلب إضافي الآن يهدد اتصال المتجر كاملاً. نوقف التِك
        // لهذا المتجر؛ الصف الفاشل يُعاد يدوياً من الشاشة، والباقي يبقى معتمداً
        // غير منشور فيلتقطه التِك التالي.
        stoppedByRateLimit = true;
        break;
      }
    }
    await sleep(SALLA_DELAY_MS);
  }

  return { merchantId, picked: rows.length, published, failed, stoppedByRateLimit };
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const requestId = generateRequestId();

  if (!env.CRON_SECRET) {
    logError(context, { requestId, path: "cron/bulk_process", code: "CRON_SECRET_MISSING", internal: "CRON_SECRET not configured" });
    return notConfigured(requestId);
  }
  const authHeader = request.headers.get("Authorization") || "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!timingSafeEqualStr(provided, env.CRON_SECRET)) return unauthorized(requestId);
  if (!env.DB) {
    logError(context, { requestId, path: "cron/bulk_process", code: "DB_BINDING_MISSING", internal: "env.DB binding absent" });
    return notConfigured(requestId);
  }

  const catalog = await tickCatalogSync(context, env, requestId);
  if (catalog) await sleep(SALLA_DELAY_MS); // فاصل قبل أي طلب سلة تالٍ بنفس التِك

  const revived = await tickReviveDeferred(context, env, requestId);
  const generate = await tickGenerate(context, env, requestId);
  const publish = await tickPublish(context, env, requestId);

  await recordHeartbeat(env, {
    job: "bulk_process",
    ok: true,
    note: `gen=${generate.queuedForReview}/${generate.failed} pub=${publish?.published ?? 0}`
  });

  return new Response(
    JSON.stringify({
      ok: true,
      catalog,
      revived,
      // مفاتيح متوافقة مع القارئ القديم (picked/done/failed) + الجديدة.
      picked: generate.picked,
      done: generate.queuedForReview,
      failed: generate.failed,
      generate,
      publish
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

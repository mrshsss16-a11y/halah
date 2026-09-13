// تِك طابور الجملة (المرحلة ٤: نُقل من `api/cron/bulk_process.js`).
// مفصول عن `bulk.js` — ذاك وصولٌ للجداول، وهذا تنسيق المراحل الثلاث فوقه.
import { listActiveBulkJobItems, completeBulkJobItem, claimNextCatalogSyncJob, advanceCatalogSyncJob, failCatalogSyncJob, listMerchantsWithDeferredItems, reviveDeferredItems, DEFERRED_MARKER } from "./bulk.js";
import { syncCatalogPage, getCatalogItem } from "./catalog.js";
import { enqueue, claimNextPublishMerchant, listApprovedUnpublished } from "./review.js";
import { publishApproved } from "./publish.js";
import { checkAndConsumeMonthly, getMonthlyUsage, refundQuota } from "../core/meter.js";
import { logError } from "../core/errorLog.js";

// ── المرحلة ٤: تِك طابور الجملة (نُقل من api/cron/bulk_process.js) ──────────
//
// ثلاث مراحل بطابور واحد (docs/PLAN_BULK_SEO.md §٣):
//   ① catalog_sync   صفحة كتالوج واحدة لكل تِك (حد سلة ١ طلب/ثانية لكل متجر).
//   ② seo_generate   توليد AI فقط — **صفر كتابة على سلة**. كل مخرج يدخل
//                    review_queue بحالة pending. هذا الفصل هو ما يجعل
//                    "الـAI يقترح والإنسان يقرر" حقيقياً لا شعاراً.
//   ③ seo_publish    المعتمَد فقط، متجر واحد لكل تِك، فاصل ≥ ١.١ث بين كل
//                    كتابة، وتوقف فوري عند ٤٢٩. النشر يمر حصراً عبر
//                    `domain/publish.js` (المكان الوحيد لإرسال مخرج AI لمنصة).
//
// لماذا فُصل التوليد عن النشر: نداء AI لا علاقة له بحد سلة؛ دمجهما كان يورّث
// التوليد قيد ١/ثانية بلا سبب (٢٠٠ منتج = ٣.٤ ساعة بدل دقائق).
//
// `generateCopy` يُحقن من نقطة الدخول لا يُستورد هنا: المولّد يعيش بطبقة أعلى
// (api/copy.js حتى تنقله مرحلته)، وحقنه يُبقي هذا الملف بلا اعتماد عكسي.
const GENERATE_BATCH = 20; // نداءات AI فقط — لا فاصل سلة بينها
const PUBLISH_BATCH = 20; // ~22s عند ١.١ث/كتابة — داخل استدعاء Worker واحد
const SALLA_DELAY_MS = 1100; // > حد سلة ١ طلب/ثانية

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    specsTable: Array.isArray(parsed?.specsTable) ? parsed.specsTable.slice(0, 15) : [],
    generatedAt: new Date().toISOString()
  };
}

// ① سحب صفحة كتالوج واحدة.
async function tickCatalogSync(log) {
  const { env } = log;
  const syncJob = await claimNextCatalogSyncJob(env).catch(() => null);
  if (!syncJob) return null;
  try {
    const page = Number(syncJob.cursor) > 0 ? Number(syncJob.cursor) : 1;
    const result = await syncCatalogPage(env, { merchantId: syncJob.merchant_id, page });
    await advanceCatalogSyncJob(env, { jobId: syncJob.id, imported: result.imported, nextPage: result.nextPage });
    if (result.skippedNoSku > 0) {
      // لا إسقاط صامت: المنتجات بلا SKU لا يمكن تخزينها (المفتاح يتطلبه).
      log.error("CATALOG_ITEMS_WITHOUT_SKU", syncJob.merchant_id, `job=${syncJob.id} page=${page} skippedNoSku=${result.skippedNoSku}`);
    }
    return { jobId: syncJob.id, page, imported: result.imported, skippedNoSku: result.skippedNoSku, hasMore: result.hasMore };
  } catch (err) {
    log.error("CATALOG_SYNC_FAILED", syncJob.merchant_id, `job=${syncJob.id} ${String((err && err.message) || err).slice(0, 250)}`);
    await failCatalogSyncJob(env, syncJob.id).catch(() => {});
    return { jobId: syncJob.id, failed: true };
  }
}

// إحياء المؤجَّل: متجر تجدّدت حصته يستعيد صفوفه المقصوصة بلا أي فعل منه.
async function tickReviveDeferred(log) {
  const { env } = log;
  let revived = 0;
  for (const m of await listMerchantsWithDeferredItems(env).catch(() => [])) {
    try {
      const usage = await getMonthlyUsage(env, m.merchant_id);
      const remaining = Number(usage?.description?.remaining || 0);
      if (remaining <= 0) continue;
      revived += await reviveDeferredItems(env, { merchantId: m.merchant_id, limit: Math.min(remaining, Number(m.deferred) || 0) });
    } catch (err) {
      log.error("DEFERRED_REVIVE_FAILED", m.merchant_id, String(err?.message || err).slice(0, 250));
    }
  }
  return revived;
}

// ② توليد → بوابة المراجعة. صفر استيراد لسلة هنا (اختبار BULK-1 يحرس ذلك).
async function tickGenerate(log, generateCopy) {
  const { env } = log;
  const items = await listActiveBulkJobItems(env, GENERATE_BATCH);
  let queuedForReview = 0;
  let failed = 0;

  for (const item of items) {
    let consumed = false;
    try {
      const usage = await checkAndConsumeMonthly(env, item.merchant_id, "description");
      if (!usage.ok) {
        // حد اليوم (للمتجر أو للمشروع) ⇒ مؤجَّل يُحيا تلقائياً مع تجدد الحد، لا فاشل.
        await completeBulkJobItem(env, { itemId: item.id, jobId: item.job_id, status: "skipped", error: DEFERRED_MARKER });
        failed++;
        continue;
      }
      consumed = true;

      // بيانات الكتالوج (إن سُحب): الصورة والوصف الحالي يرفعان جودة التوليد
      // ويظهران بشاشة المراجعة "الحالي ← المقترح". غيابها = مسار CSV اليدوي.
      const catalogRow = await getCatalogItem(env, { merchantId: item.merchant_id, sku: item.sku }).catch(() => null);

      const parsed = await generateCopy({
        env,
        merchantId: item.merchant_id,
        name: item.name,
        price: item.price,
        tone: item.tone,
        category: item.category,
        features: "",
        existingDescription: catalogRow?.current_description || "",
        imageUrl: catalogRow?.image_url || "",
        // نفس بيانات المسار المفرد: الخيارات مؤكَّدة من التاجر وتتقدّم على الصورة.
        variants: catalogRow?.variants || null
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
      log.error("BULK_ITEM_FAILED", item.merchant_id, `item=${item.id} ${String((err && err.message) || err).slice(0, 250)}`);
      if (consumed) await refundQuota(env, item.merchant_id, "description").catch(() => {});
      await completeBulkJobItem(env, { itemId: item.id, jobId: item.job_id, status: "failed", error: "تعذّرت معالجة هذا الصف. جرّبه مرة ثانية." });
      failed++;
    }
  }

  return { picked: items.length, queuedForReview, failed };
}

// ③ نشر المعتمَد — متجر واحد لكل تِك.
async function tickPublish(log) {
  const { env } = log;
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
      log.error("SEO_PUBLISH_FAILED", merchantId, `review=${row.id} ${String(result.error || "").slice(0, 250)}`);
      if (result.retryAfter) {
        // ٤٢٩ من سلة: أي طلب إضافي الآن يهدد اتصال المتجر كاملاً. نوقف التِك
        // لهذا المتجر؛ الباقي يبقى معتمداً غير منشور فيلتقطه التِك التالي.
        stoppedByRateLimit = true;
        break;
      }
    }
    await sleep(SALLA_DELAY_MS);
  }

  return { merchantId, picked: rows.length, published, failed, stoppedByRateLimit };
}

/**
 * تِك واحد كامل للطابور. `generateCopy` مُحقَن (انظر ترويسة القسم).
 * @returns {Promise<{catalog, revived, generate, publish}>}
 */
export async function runBulkTick(env, { context, requestId, generateCopy }) {
  const log = {
    env,
    error: (code, storeId, internal) =>
      logError(context, { requestId, path: "cron/bulk_process", code, storeId, internal })
  };

  const catalog = await tickCatalogSync(log);
  if (catalog) await sleep(SALLA_DELAY_MS); // فاصل قبل أي طلب سلة تالٍ بنفس التِك

  const revived = await tickReviveDeferred(log);
  const generate = await tickGenerate(log, generateCopy);
  const publish = await tickPublish(log);

  return { catalog, revived, generate, publish };
}

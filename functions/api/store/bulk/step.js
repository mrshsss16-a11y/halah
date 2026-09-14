// POST /api/store/bulk/step — body: { jobId }
// المعالجة الفورية للتوليد بالجملة (2026-09-14): الصفحة المفتوحة تطلب منتجاً واحداً بكل نداء،
// بالتتابع — ٥ أوصاف خلال دقيقة ونصف تقريباً بدل انتظار دفعة الـcron كل ١٠ دقائق. التتابع مقصود:
// nexos يرجع ٤٢٩ مع النداءات المتوازية. إغلاق الصفحة لا يوقف شيئاً — الـcron يكمل الباقي.
//
// الأمان: الوظيفة مقيّدة بالتاجر (getBulkJob)، الصف محجوز ذرّياً (claimNextJobItem)، والحصة
// تُحسم ذرّياً بـmeter.js داخل processBulkItem — لا تجاوز لحد اليوم بتكرار النداء أو توازيه.
import { withApi } from "../../../_lib/core/respond.js";
import { requireCompletedAccount } from "../../../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../../../_lib/core/rateLimit.js";
import { getBulkJob, claimNextJobItem } from "../../../_lib/domain/bulk.js";
import { processBulkItem } from "../../../_lib/domain/bulkTick.js";
import { generateProductCopy } from "../../../_lib/domain/copy.js";
import { logError } from "../../../_lib/core/errorLog.js";

async function bulkStepHandler(body, env, request) {
  const rl = await checkRateLimit(env, clientIp(request), "bulk_step", 40, 300);
  if (!rl.allowed) return { ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED", retryAfter: rl.resetInSeconds };

  const merchantId = await requireCompletedAccount(request, env, body.storeId);
  const jobId = (body.jobId || "").toString().trim().slice(0, 60);
  if (!jobId) return { ok: false, error: "jobId مطلوب.", code: "BAD_REQUEST" };

  const job = await getBulkJob(env, jobId, merchantId);
  if (!job) return { ok: false, error: "لم يوجد.", code: "JOB_NOT_FOUND" };

  const item = await claimNextJobItem(env, { jobId, merchantId });
  if (!item) return { ok: true, idle: true };

  const log = {
    env,
    error: (code, storeId, internal) => logError({ env }, { requestId: null, path: "api/store/bulk/step", code, storeId, internal })
  };
  const outcome = await processBulkItem(log, item, generateProductCopy);
  return { ok: true, idle: false, sku: item.sku, outcome };
}

export const onRequestPost = withApi(bulkStepHandler);

// POST /api/store/bulk/status — body: { storeId, jobId }
// Progress poll for a B3 bulk job while cron/bulk_process.js drains it.
import { withApi } from "../../../_lib/core/respond.js";
import { resolveStoreId } from "../../../_lib/core/session.js";
import { getBulkJob, failedBulkItems } from "../../../_lib/domain/bulk.js";

async function bulkStatusHandler(body, env, request) {
  // store-gate-ok: تقدّم الوظيفة قراءة فقط، والوظيفة نفسها مقيّدة بـmerchant_id عبر getBulkJob
  const merchantId = await resolveStoreId(request, env, body.storeId);
  const jobId = (body.jobId || "").toString().trim().slice(0, 60);
  if (!jobId) return { ok: false, error: "jobId مطلوب." };

  const job = await getBulkJob(env, jobId, merchantId);
  if (!job) return { ok: false, error: "لم يوجد." };

  const failedItems = await failedBulkItems(env, jobId);

  return {
    ok: true,
    jobId: job.id,
    status: job.status,
    total: job.total,
    processed: job.processed,
    succeeded: job.succeeded,
    failed: job.failed,
    failedItems
  };
}

export const onRequestPost = withApi(bulkStatusHandler);

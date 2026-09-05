// POST /api/store/bulk/status — body: { storeId, jobId }
// Progress poll for a B3 bulk job while cron/bulk_process.js drains it.
import { withApi } from "../../../_lib/core/respond.js";
import { resolveStoreId } from "../../../_lib/core/session.js";
import { getBulkJob } from "../../../_lib/core/db.js";

async function bulkStatusHandler(body, env, request) {
  const merchantId = await resolveStoreId(request, env, body.storeId);
  const jobId = (body.jobId || "").toString().trim().slice(0, 60);
  if (!jobId) return { ok: false, error: "jobId مطلوب." };

  const job = await getBulkJob(env, jobId, merchantId);
  if (!job) return { ok: false, error: "لم يوجد." };

  const items = await env.DB.prepare(
    "SELECT row_index, sku, name, status, error FROM bulk_job_items WHERE job_id = ? AND status IN ('failed','skipped') ORDER BY row_index ASC LIMIT 50"
  )
    .bind(jobId)
    .all();

  return {
    ok: true,
    jobId: job.id,
    status: job.status,
    total: job.total,
    processed: job.processed,
    succeeded: job.succeeded,
    failed: job.failed,
    failedItems: items.results || []
  };
}

export const onRequestPost = withApi(bulkStatusHandler);

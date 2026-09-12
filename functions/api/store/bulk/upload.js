// POST /api/store/bulk/upload — body: { storeId, tone, rows: [{name, price?, category?, sku}] }
// B3: bulk product-description job. Rows are validated/capped here and queued
// as bulk_job_items; functions/api/cron/bulk_process.js drains the queue a
// few items per 10-minute tick (Salla's real limit is 1 req/sec — see
// .claude/skills/salla-integration/SKILL.md — so this can't run inline).
import { withApi } from "../../../_lib/core/respond.js";
import { requireCompletedAccount } from "../../../_lib/core/session.js";
import { createBulkJob, markDeferredItems } from "../../../_lib/domain/bulk.js";
import { getMonthlyUsage } from "../../../_lib/core/meter.js";
import { checkRateLimit, clientIp } from "../../../_lib/core/rateLimit.js";

const MAX_ROWS_PER_UPLOAD = 500;

async function bulkUploadHandler(body, env, request) {
  // A bulk job queues up to 500 AI generations + Salla writes — cap how fast
  // jobs can be created per IP (SECURITY_AUDIT C2).
  const rl = await checkRateLimit(env, clientIp(request), "bulk_upload", 5, 300);
  if (!rl.allowed) {
    return { ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" };
  }

  // Queues up to 500 AI generations for the cron drainer — never anonymously.
  const merchantId = await requireCompletedAccount(request, env, body.storeId);
  const tone = ["white", "formal", "luxury", "deals", "funny"].includes(body.tone) ? body.tone : "white";
  const rawRows = Array.isArray(body.rows) ? body.rows : [];

  if (!rawRows.length) return { ok: false, error: "لا يوجد صفوف." };
  if (rawRows.length > MAX_ROWS_PER_UPLOAD) {
    return { ok: false, error: `الحد الأقصى ${MAX_ROWS_PER_UPLOAD} منتج بالدفعة الواحدة — قسّم الملف.` };
  }

  const rows = [];
  let skippedInvalid = 0;
  for (const r of rawRows) {
    const sku = (r?.sku || "").toString().trim().slice(0, 100);
    const name = (r?.name || "").toString().trim().slice(0, 200);
    if (!sku || !name) { skippedInvalid++; continue; }
    rows.push({
      sku,
      name,
      price: (r?.price || "").toString().trim().slice(0, 40),
      category: (r?.category || "").toString().trim().slice(0, 60)
    });
  }
  if (!rows.length) return { ok: false, error: "كل الصفوف ناقصة اسم أو SKU." };

  // الحد يومي (2026-09-12): ما يتجاوز متبقي اليوم يُعلَّم مؤجَّلاً فوراً ويُحيا تلقائياً مع تجدد
  // الحد — كان يُقصّ ويضيع، وبحد ٥ يومياً كان سيضيع أغلب الملف.
  const usage = await getMonthlyUsage(env, merchantId);
  const remaining = Math.max(0, Number(usage.description.remaining) || 0);
  const nowCount = Math.min(rows.length, remaining);
  const deferred = rows.length - nowCount;

  const jobId = `bulk_${crypto.randomUUID().slice(0, 12)}`;
  await createBulkJob(env, { id: jobId, merchantId, tone, rows });
  await markDeferredItems(env, { jobId, merchantId, fromIndex: nowCount, count: deferred });

  return {
    ok: true,
    jobId,
    queued: nowCount,
    deferred,
    skippedInvalid,
    skippedOverQuota: 0,
    message: deferred ? `بدأنا بـ${nowCount} اليوم (حدك ${usage.description.limit} أوصاف يومياً)، و${deferred} مؤجَّلة تُكمَل تلقائياً يوماً بيوم.` : null,
    etaMinutes: Math.ceil(nowCount / 60) // ≈60 items/min per store, sequential (rate-limit design)
  };
}

export const onRequestPost = withApi(bulkUploadHandler);

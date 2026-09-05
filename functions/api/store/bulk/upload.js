// POST /api/store/bulk/upload — body: { storeId, tone, rows: [{name, price?, category?, sku}] }
// B3: bulk product-description job. Rows are validated/capped here and queued
// as bulk_job_items; functions/api/cron/bulk_process.js drains the queue a
// few items per 10-minute tick (Salla's real limit is 1 req/sec — see
// .claude/skills/salla-integration/SKILL.md — so this can't run inline).
import { withApi } from "../../../_lib/core/respond.js";
import { resolveStoreId } from "../../../_lib/core/session.js";
import { createBulkJob } from "../../../_lib/core/db.js";
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

  const merchantId = await resolveStoreId(request, env, body.storeId);
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

  // Cap to remaining monthly description quota up front so the job doesn't
  // burn cron ticks on items that will fail the quota check one-by-one later.
  const usage = await getMonthlyUsage(env, merchantId);
  const remaining = usage.description.remaining;
  let capped = 0;
  if (rows.length > remaining) {
    capped = rows.length - remaining;
    rows.length = remaining;
  }
  if (!rows.length) {
    return { ok: false, error: `خلصت أوصاف هالشهر المجانية (${usage.description.limit}) — تتجدد أول الشهر الجاي.`, code: "OUT_OF_CREDITS" };
  }

  const jobId = `bulk_${crypto.randomUUID().slice(0, 12)}`;
  await createBulkJob(env, { id: jobId, merchantId, tone, rows });

  return {
    ok: true,
    jobId,
    queued: rows.length,
    skippedInvalid,
    skippedOverQuota: capped,
    etaMinutes: Math.ceil(rows.length / 60) // ≈60 items/min per store, sequential (rate-limit design)
  };
}

export const onRequestPost = withApi(bulkUploadHandler);

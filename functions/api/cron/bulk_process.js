// GET /api/cron/bulk_process — B3 queue drain, ticked every 10 min by
// cron-worker/index.js. Salla's real binding limit is a 1 req/sec leak
// bucket across ALL plan tiers (.claude/skills/salla-integration/SKILL.md),
// so this processes a small batch sequentially with an explicit delay
// between items rather than a single big HTTP request or Promise.all.
import { generateProductCopy } from "../copy.js";
import { updateProductBySku } from "../../_lib/integrations/salla.js";
import { listActiveBulkJobItems, completeBulkJobItem } from "../../_lib/core/db.js";
import { checkAndConsumeMonthly } from "../../_lib/core/meter.js";
import { generateRequestId } from "../../_lib/core/respond.js";
import { logError } from "../../_lib/core/errorLog.js";

const BATCH_SIZE = 20; // ~22s wall time at 1.1s/item — safely inside one Worker invocation
const DELAY_MS = 1100; // > Salla's 1 req/sec leak limit

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const requestId = generateRequestId();

  if (!env.CRON_SECRET) {
    logError(context, { requestId, path: "cron/bulk_process", code: "CRON_SECRET_MISSING", internal: "CRON_SECRET not configured" });
    return new Response(JSON.stringify({ ok: false, error: "معالجة الدفعات غير مفعّلة حالياً على الخادم.", code: "CRON_NOT_CONFIGURED", requestId }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
  const authHeader = request.headers.get("Authorization") || "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (provided !== env.CRON_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: "غير مصرّح بهذا الطلب.", code: "UNAUTHORIZED", requestId }), {
      status: 401,
      headers: { "content-type": "application/json" }
    });
  }
  if (!env.DB) {
    logError(context, { requestId, path: "cron/bulk_process", code: "DB_BINDING_MISSING", internal: "env.DB binding absent" });
    return new Response(JSON.stringify({ ok: false, error: "معالجة الدفعات غير مفعّلة حالياً على الخادم.", code: "CRON_NOT_CONFIGURED", requestId }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }

  const items = await listActiveBulkJobItems(env, BATCH_SIZE);
  let done = 0;
  let failed = 0;

  for (const item of items) {
    try {
      const usage = await checkAndConsumeMonthly(env, item.merchant_id, "description");
      if (!usage.ok) {
        await completeBulkJobItem(env, { itemId: item.id, jobId: item.job_id, status: "skipped", error: "الحصة الشهرية خلصت" });
        failed++;
        continue;
      }

      const parsed = await generateProductCopy({
        env,
        merchantId: item.merchant_id,
        name: item.name,
        price: item.price,
        tone: item.tone,
        category: item.category,
        features: "",
        existingDescription: "",
        imageUrl: ""
      });

      await updateProductBySku(env, item.merchant_id, item.sku, { description: parsed.copywriting.description });

      await completeBulkJobItem(env, {
        itemId: item.id,
        jobId: item.job_id,
        status: "done",
        description: parsed.copywriting.description
      });
      done++;
    } catch (err) {
      // This column is merchant-facing — /api/store/bulk/status returns it
      // verbatim in the failed-rows list. Raw err.message here is a Salla API
      // body or an AI gateway error (English, provider ids); it goes to the
      // error log instead, and the merchant sees Arabic.
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
    await sleep(DELAY_MS);
  }

  return new Response(JSON.stringify({ ok: true, picked: items.length, done, failed }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

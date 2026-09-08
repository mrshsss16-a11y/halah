// POST /api/store/bulk/generate — body: { storeId?, tone?, limit? }
// توليد جماعي من الكتالوج المسحوب (المرحلة ٢ · docs/PLAN_BULK_SEO.md §٦):
// صفر كتابة يدوية — المنتجات تُقرأ من store_products بأولوية عائد SEO
// (بلا وصف ← وصف قصير ← الأحدث)، وما فوق حصة الشهر يُخزَّن **مؤجَّلاً** لا
// مرفوضاً، ويُحيا تلقائياً أول تِك بعد تجدّد الحصة.
//
// الحقيقة تُقال قبل البدء: "متجرك فيه N منتج، باقتك تغطي M هالشهر."
import { withApi } from "../../../_lib/core/respond.js";
import { requireCompletedAccount } from "../../../_lib/core/session.js";
import { createBulkJob, getActiveJobByKind, DEFERRED_MARKER } from "../../../_lib/core/db.js";
import { getMonthlyUsage } from "../../../_lib/core/meter.js";
import { checkRateLimit, clientIp } from "../../../_lib/core/rateLimit.js";
import { listPriorityCatalog, countCatalog } from "../../../_lib/services/catalog.js";

const MAX_ROWS = 500;
const TONES = ["white", "formal", "luxury", "deals", "funny"];

async function bulkGenerateHandler(body, env, request) {
  const rl = await checkRateLimit(env, clientIp(request), "bulk_generate", 3, 300);
  if (!rl.allowed) {
    return { ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" };
  }

  const merchantId = await requireCompletedAccount(request, env, body.storeId);
  const tone = TONES.includes(body.tone) ? body.tone : "white";
  const requested = Math.min(Math.max(Number(body.limit) || MAX_ROWS, 1), MAX_ROWS);

  const running = await getActiveJobByKind(env, merchantId, "seo_generate");
  if (running) {
    return { ok: false, error: "فيه توليد شغّال لمتجرك الحين — راجع المقترحات أو انتظر لين يخلص.", code: "GENERATE_ALREADY_RUNNING", jobId: running.id };
  }

  const total = await countCatalog(env, { merchantId });
  if (!total) {
    return { ok: false, error: "ما سحبنا منتجاتك بعد — اضغط «اسحب منتجاتي من سلة» أولاً.", code: "CATALOG_EMPTY" };
  }

  const usage = await getMonthlyUsage(env, merchantId);
  const remaining = Math.max(0, Number(usage?.description?.remaining || 0));
  const limitMonthly = Number(usage?.description?.limit || 0);

  const candidates = await listPriorityCatalog(env, { merchantId, limit: requested });
  const rows = candidates.map((c) => ({ sku: c.sku, name: c.name, price: c.price || "", category: c.category || "" }));

  const now = rows.slice(0, remaining);
  const deferred = rows.slice(remaining);

  if (!now.length && !deferred.length) {
    return { ok: false, error: "ما فيه منتجات صالحة للتوليد.", code: "NOTHING_TO_GENERATE" };
  }

  const jobId = `bulk_${crypto.randomUUID().slice(0, 12)}`;
  await createBulkJob(env, { id: jobId, merchantId, tone, rows: [...now, ...deferred] });

  // ما فوق الحصة يُعلَّم مؤجَّلاً فوراً (لا ينتظر أن يفشل صفاً صفاً بالـcron).
  if (deferred.length) {
    // tenant-audit-ok: job_id أُنشئ للتو لهذا التاجر بنفس الدالة (createBulkJob) — لا مدخل عميل.
    await env.DB.prepare(
      `UPDATE bulk_job_items SET status = 'skipped', error = ?, updated_at = datetime('now')
        WHERE job_id = ? AND row_index >= ?`
    )
      .bind(DEFERRED_MARKER, jobId, now.length)
      .run();
    // tenant-audit-ok: نفس job_id الموثوق؛ العدّادات تعكس المؤجَّل كمعالَج/فاشل مؤقتاً حتى يُحيا.
    await env.DB.prepare(
      `UPDATE bulk_jobs SET processed = processed + ?, failed = failed + ?, updated_at = datetime('now') WHERE id = ? AND merchant_id = ?`
    )
      .bind(deferred.length, deferred.length, jobId, merchantId)
      .run();
  }

  const message = deferred.length
    ? `متجرك فيه ${total} منتج، وباقتك تغطي ${limitMonthly} وصف هالشهر (باقي ${remaining}). بدأنا بـ${now.length} الأعلى أثراً، و${deferred.length} مؤجَّلة تُكمَل تلقائياً أول الشهر الجاي.`
    : `بدأنا توليد ${now.length} وصف من ${total} منتج. راجعها هنا قبل أي نشر.`;

  return {
    ok: true,
    jobId,
    catalogTotal: total,
    queued: now.length,
    deferred: deferred.length,
    quota: { limit: limitMonthly, remaining },
    upgradeHint: deferred.length ? `${deferred.length} منتج جاهز للتوليد — رقّي الباقة وتنتهي اليوم بدل الانتظار.` : null,
    etaMinutes: Math.max(1, Math.ceil(now.length / 20) * 10), // ٢٠ توليداً لكل تِك ١٠ دقائق — تقدير صادق لا وعد
    message
  };
}

export const onRequestPost = withApi(bulkGenerateHandler);

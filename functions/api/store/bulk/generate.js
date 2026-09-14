// POST /api/store/bulk/generate — body: { storeId?, tone?, limit?, skus?, notes?: { sku: «وش يميزه» } }
// «متجرك فيه N منتج، باقتك تغطي M اليوم» تُقال قبل البدء. توليد جماعي من الكتالوج (docs/PLAN_BULK_SEO.md §٦): ما فوق حد اليوم يُخزَّن **مؤجَّلاً** ويُحيا مع تجدّده.
// الوظيفة تُنشأ هنا فقط؛ التوليد فوراً من الصفحة (bulk/step) والـcron احتياط.
import { withApi } from "../../../_lib/core/respond.js";
import { requireCompletedAccount } from "../../../_lib/core/session.js";
import { createBulkJob, getActiveJobByKind, markDeferredItems } from "../../../_lib/domain/bulk.js";
import { getMonthlyUsage } from "../../../_lib/core/meter.js";
import { checkRateLimit, clientIp } from "../../../_lib/core/rateLimit.js";
import { listPriorityCatalog, countCatalog, selectCatalogBySkus } from "../../../_lib/domain/catalog.js";
import { cleanNotesBySku, saveJobNotes } from "../../../_lib/domain/merchantNote.js";

const MAX_ROWS = 500;
const TONES = ["white", "formal", "luxury", "deals", "funny", "brand"];

async function bulkGenerateHandler(body, env, request) {
  const rl = await checkRateLimit(env, clientIp(request), "bulk_generate", 3, 300);
  if (!rl.allowed) return { ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" };

  const merchantId = await requireCompletedAccount(request, env, body.storeId);
  const tone = TONES.includes(body.tone) ? body.tone : "white";
  const requested = Math.min(Math.max(Number(body.limit) || MAX_ROWS, 1), MAX_ROWS);

  const running = await getActiveJobByKind(env, merchantId, "seo_generate");
  if (running) return { ok: false, error: "فيه توليد شغّال لمتجرك الحين — راجع المقترحات أو انتظر لين يخلص.", code: "GENERATE_ALREADY_RUNNING", jobId: running.id };

  const total = await countCatalog(env, { merchantId });
  if (!total) return { ok: false, error: "ما سحبنا منتجاتك بعد — اضغط «اسحب منتجاتي من سلة» أولاً.", code: "CATALOG_EMPTY" };

  const usage = await getMonthlyUsage(env, merchantId);
  const remaining = Math.max(0, Number(usage?.description?.remaining || 0));
  const limitMonthly = Number(usage?.description?.limit || 0);

  // قائمة SKU صريحة من شبكة «منتجاتي» تتقدّم على الأولوية التلقائية؛ `selectCatalogBySkus` يقيّد بالتاجر.
  const chosenSkus = Array.isArray(body.skus)
    ? body.skus.map((s) => String(s ?? "").trim()).filter(Boolean)
    : [];
  const candidates = chosenSkus.length
    ? await selectCatalogBySkus(env, { merchantId, skus: chosenSkus })
    : await listPriorityCatalog(env, { merchantId, limit: requested });

  if (chosenSkus.length && !candidates.length) {
    return { ok: false, error: "المنتجات المحددة ما لقيناها بكتالوجك — اضغط «تحديث المنتجات» ثم أعد الاختيار.", code: "SELECTION_NOT_FOUND" };
  }

  const rows = candidates.map((c) => ({ sku: c.sku, name: c.name, price: c.price || "", category: c.category || "" }));

  const now = rows.slice(0, remaining);
  const deferred = rows.slice(remaining);
  if (!now.length && !deferred.length) return { ok: false, error: "ما فيه منتجات صالحة للتوليد.", code: "NOTHING_TO_GENERATE" };

  const jobId = `bulk_${crypto.randomUUID().slice(0, 12)}`;
  await createBulkJob(env, { id: jobId, merchantId, tone, rows: [...now, ...deferred] });
  await saveJobNotes(env, jobId, cleanNotesBySku(body.notes, rows.map((r) => r.sku)));

  await markDeferredItems(env, { jobId, merchantId, fromIndex: now.length, count: deferred.length });

  const message = deferred.length
    ? `متجرك فيه ${total} منتج، وحدك اليومي ${limitMonthly} أوصاف (باقي اليوم ${remaining}). بدأنا بـ${now.length} الأعلى أثراً، و${deferred.length} مؤجَّلة تُكمَل تلقائياً يوماً بيوم.`
    : `بدأنا توليد ${now.length} وصف من ${total} منتج. راجعها هنا قبل أي نشر.`;

  return {
    ok: true,
    jobId,
    catalogTotal: total,
    queued: now.length,
    deferred: deferred.length,
    quota: { limit: limitMonthly, remaining },
    upgradeHint: null, // لا مسار ترقية باللوحة بعد (2026-09-13) — وعد بما لا يُصرف يخالف قاعدة الصدق
    etaMinutes: Math.max(1, Math.ceil((now.length * 20) / 60)), // ~٢٠ث للمنتج بالمعالجة الفورية — تقدير لا وعد
    message
  };
}

export const onRequestPost = withApi(bulkGenerateHandler);

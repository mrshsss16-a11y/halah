// مجال العمل بالجملة: `bulk_jobs`/`bulk_job_items`، طابور سحب الكتالوج
// (`kind = 'catalog_sync'`)، وإحياء الصفوف المؤجَّلة عن حصة الشهر.
// نُقل من core/db.js بالمرحلة ٣ (ARCHITECTURE §٢) بلا تغيير سلوكي.

// ── B3: bulk description jobs ───────────────────────────────────────────────
export async function createBulkJob(env, { id, merchantId, tone, rows }) {
  await env.DB.prepare(
    "INSERT INTO bulk_jobs (id, merchant_id, tone, total) VALUES (?, ?, ?, ?)"
  )
    .bind(id, merchantId, tone, rows.length)
    .run();

  // D1 batch() is one round-trip instead of N — matters at up to 1000 rows.
  const stmt = env.DB.prepare(
    "INSERT INTO bulk_job_items (job_id, row_index, sku, name, price, category) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const batch = rows.map((r, i) => stmt.bind(id, i, r.sku, r.name, r.price || null, r.category || null));
  for (let i = 0; i < batch.length; i += 100) {
    await env.DB.batch(batch.slice(i, i + 100));
  }
  return id;
}

export async function getBulkJob(env, jobId, merchantId) {
  return env.DB.prepare("SELECT * FROM bulk_jobs WHERE id = ? AND merchant_id = ?")
    .bind(jobId, merchantId)
    .first();
}

export async function listActiveBulkJobItems(env, limit) {
  // Oldest running job first so one big job doesn't starve one queued behind it.
  const { results } = await env.DB.prepare(
    `SELECT i.*, j.merchant_id AS merchant_id, j.tone AS tone FROM bulk_job_items i
     JOIN bulk_jobs j ON j.id = i.job_id
     WHERE j.status = 'running' AND i.status = 'pending' AND (i.error IS NULL OR i.updated_at < datetime('now', ?))
     ORDER BY j.created_at ASC, i.row_index ASC
     LIMIT ?`
  )
    .bind(CLAIM_LEASE, limit)
    .all();
  return results || [];
}

// حجز الصف قبل توليده: الصفحة المفتوحة (api/store/bulk/step) والـcron قد يلتقطان الصف نفسه بنفس اللحظة.
// لا عمود حالة جديد (CHECK بالجدول): `error = CLAIM_MARKER` مع updated_at عقدُ إيجار ٣ دقائق — صف علق
// بتبويب أُغلق وسط التوليد يعود قابلاً للالتقاط بعدها. الحصة نفسها تُحسم ذرّياً بـmeter.js فوق هذا.
const CLAIM_MARKER = "قيد الكتابة";
const CLAIM_LEASE = "-180 seconds";

// tenant-audit-ok: itemId من صف قرأه listActiveBulkJobItems أو claimNextJobItem (مقيّد بالتاجر).
export async function claimBulkItem(env, itemId) {
  const res = await env.DB.prepare(
    "UPDATE bulk_job_items SET error = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending' AND (error IS NULL OR updated_at < datetime('now', ?))"
  )
    .bind(CLAIM_MARKER, itemId, CLAIM_LEASE)
    .run();
  return Boolean(res?.meta?.changes);
}

/** الصف التالي لوظيفة هذا التاجر، محجوزاً له — null حين لا شيء قابل للالتقاط الآن. */
export async function claimNextJobItem(env, { jobId, merchantId }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await env.DB.prepare(
      `SELECT i.*, j.merchant_id AS merchant_id, j.tone AS tone FROM bulk_job_items i
       JOIN bulk_jobs j ON j.id = i.job_id
       WHERE i.job_id = ? AND j.merchant_id = ? AND j.status = 'running' AND i.status = 'pending'
         AND (i.error IS NULL OR i.updated_at < datetime('now', ?))
       ORDER BY i.row_index ASC LIMIT 1`
    )
      .bind(jobId, merchantId, CLAIM_LEASE)
      .first();
    if (!row) return null;
    if (await claimBulkItem(env, row.id)) return row;
  }
  return null;
}

// tenant-audit-ok (whole function): itemId/jobId here are never attacker input —
// the sole caller (functions/api/cron/bulk_process.js, allowlisted) reads them
// off `item` rows already produced by listActiveBulkJobItems() above, which
// joins bulk_jobs internally. No merchant-facing endpoint calls this directly;
// if one ever does, it must pass through getBulkJob(jobId, merchantId) first.
export async function completeBulkJobItem(env, { itemId, jobId, status, description, error, seoPayload = null, reviewId = null }) {
  await env.DB.prepare(
    "UPDATE bulk_job_items SET status = ?, description = ?, error = ?, seo_payload = ?, review_id = ?, updated_at = datetime('now') WHERE id = ?"
  )
    .bind(status, description || null, error || null, seoPayload === null ? null : String(seoPayload).slice(0, 20000), reviewId, itemId)
    .run();

  const succeededDelta = status === "done" ? 1 : 0;
  const failedDelta = status === "failed" || status === "skipped" ? 1 : 0;
  // tenant-audit-ok: jobId is trusted (see function-header note above) — this
  // internal progress counter is not merchant-facing.
  await env.DB.prepare(
    `UPDATE bulk_jobs SET
       processed = processed + 1,
       succeeded = succeeded + ?,
       failed = failed + ?,
       updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(succeededDelta, failedDelta, jobId)
    .run();

  // tenant-audit-ok: same trusted jobId, internal completion check.
  const job = await env.DB.prepare("SELECT total, processed FROM bulk_jobs WHERE id = ?").bind(jobId).first();
  if (job && job.processed >= job.total) {
    // tenant-audit-ok: same trusted jobId, internal status flip.
    await env.DB.prepare("UPDATE bulk_jobs SET status = 'done', updated_at = datetime('now') WHERE id = ?")
      .bind(jobId)
      .run();
  }
}

// ── المرحلة ١ (docs/PLAN_BULK_SEO.md): طابور موجّه بـkind ────────────────────
// نفس جدول bulk_jobs، وعمود `kind` يقرر أي معالج يصرّف الوظيفة بالـcron.
// وظائف catalog_sync بلا bulk_job_items إطلاقاً: تقدّمها محفوظ بـ`cursor`
// (رقم الصفحة التالية بسلة) لأن صفحة واحدة فقط تُسحب لكل تِك — تجاوز حد
// ١ طلب/ثانية يوقف اتصال المتجر كاملاً لا الطلب وحده.

/** وظيفة نشطة من نوع معيّن لهذا التاجر — لمنع وظيفتين متوازيتين على نفس المتجر. */
export async function getActiveJobByKind(env, merchantId, kind) {
  if (!env.DB || !merchantId) return null;
  return env.DB.prepare(
    "SELECT id, kind, status, cursor, processed, succeeded, failed, created_at FROM bulk_jobs WHERE merchant_id = ? AND kind = ? AND status = 'running' ORDER BY created_at DESC"
  )
    .bind(merchantId, kind)
    .first();
}

/** ينشئ وظيفة سحب كتالوج (بلا صفوف — التقدّم بالـcursor). */
export async function createCatalogSyncJob(env, { id, merchantId }) {
  await env.DB.prepare(
    "INSERT INTO bulk_jobs (id, merchant_id, kind, cursor, total) VALUES (?, ?, 'catalog_sync', '1', 0)"
  )
    .bind(id, merchantId)
    .run();
  return id;
}

// tenant-audit-ok: مسح على مستوى الخادم لطابور الـcron — بالتعريف عابر
// للمستأجرين (مثل listActiveBulkJobItems). merchant_id يعود بالصف نفسه
// ويُمرَّر لكل استدعاء سلة/كتالوج بعده، فالعزل يُفرض بالمستدعي.
export async function claimNextCatalogSyncJob(env) {
  return env.DB.prepare(
    "SELECT id, merchant_id, cursor, processed FROM bulk_jobs WHERE kind = 'catalog_sync' AND status = 'running' ORDER BY updated_at ASC LIMIT 1"
  ).first();
}

/** يسجّل نتيجة صفحة واحدة من السحب (عدّاد داخلي، غير مواجه للتاجر). */
export async function advanceCatalogSyncJob(env, { jobId, imported, nextPage }) {
  const finished = !nextPage;
  // tenant-audit-ok: jobId مصدره claimNextCatalogSyncJob() أعلاه (صف طابور
  // داخلي)، لا مدخل عميل. لا endpoint تاجر يستدعي هذه الدالة؛ لو استُدعيت
  // يوماً من نقطة تاجر فلازم تمرّ بـgetBulkJob(jobId, merchantId) أولاً.
  await env.DB.prepare(
    `UPDATE bulk_jobs SET
       cursor = ?,
       total = total + ?,
       processed = processed + ?,
       succeeded = succeeded + ?,
       status = CASE WHEN ? = 1 THEN 'done' ELSE status END,
       updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(
      finished ? null : String(nextPage),
      imported,
      imported,
      imported,
      finished ? 1 : 0,
      jobId
    )
    .run();
}

/** يوقف وظيفة سحب متعثّرة (خطأ سلة مثلاً) بدل تركها تدور كل تِك. */
export async function failCatalogSyncJob(env, jobId) {
  // tenant-audit-ok: نفس jobId الداخلي الموثوق أعلاه (طابور الـcron لا مدخل عميل).
  await env.DB.prepare(
    "UPDATE bulk_jobs SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?"
  )
    .bind(jobId)
    .run();
}

// ── المرحلة ٢: إحياء المؤجَّل مع تجدد الحد (docs/PLAN_BULK_SEO.md §٦) ─────────────
// صفوف قُصّت عن الحد (يومي منذ 2026-09-12) تُخزَّن بحالة skipped وسبب DEFERRED_MARKER بدل رفضها.
// يستدعيها الـcron كل تِك: لكل متجر عنده صفوف مؤجَّلة وحصة متبقية، يُعاد
// حتى `remaining` صفاً إلى pending ويُفتح الطابور من جديد — التاجر لا يعيد شيئاً.
export const DEFERRED_MARKER = "مؤجّل لليوم التالي (حد الأوصاف اليومي)";
// صفوف أُجّلت قبل تحويل الحد إلى يومي (2026-09-12) تبقى قابلة للإحياء.
const LEGACY_DEFERRED_MARKER = "مؤجّل للشهر القادم";

export async function listMerchantsWithDeferredItems(env, limit = 20) {
  // tenant-audit-ok: استعلام cron عابر للمتاجر بالتصميم — يجمع المتاجر ذات الصفوف المؤجَّلة ثم كل ما بعده معزول بـmerchant_id.
  const { results } = await env.DB.prepare(
    `SELECT j.merchant_id AS merchant_id, COUNT(*) AS deferred
       FROM bulk_job_items i JOIN bulk_jobs j ON j.id = i.job_id
      WHERE i.status = 'skipped' AND i.error IN (?, ?)
      GROUP BY j.merchant_id ORDER BY MIN(i.updated_at) ASC LIMIT ?`
  )
    .bind(DEFERRED_MARKER, LEGACY_DEFERRED_MARKER, limit)
    .all();
  return results || [];
}

export async function reviveDeferredItems(env, { merchantId, limit }) {
  const cap = Math.max(0, Math.floor(Number(limit) || 0));
  if (!cap) return 0;
  // الصفوف المؤجَّلة لهذا المتجر فقط (عبر bulk_jobs.merchant_id)، الأقدم أولاً.
  const { results } = await env.DB.prepare(
    `SELECT i.id AS id, i.job_id AS job_id
       FROM bulk_job_items i JOIN bulk_jobs j ON j.id = i.job_id
      WHERE j.merchant_id = ? AND i.status = 'skipped' AND i.error IN (?, ?)
      ORDER BY i.updated_at ASC, i.row_index ASC LIMIT ?`
  )
    .bind(merchantId, DEFERRED_MARKER, LEGACY_DEFERRED_MARKER, cap)
    .all();
  const rows = results || [];
  if (!rows.length) return 0;

  const stmts = [];
  const jobs = new Set();
  for (const r of rows) {
    // tenant-audit-ok: id مصدره الاستعلام المعزول أعلاه (نفس الدالة)، لا مدخل عميل.
    stmts.push(env.DB.prepare("UPDATE bulk_job_items SET status = 'pending', error = NULL, updated_at = datetime('now') WHERE id = ?").bind(r.id));
    jobs.add(r.job_id);
  }
  for (const jobId of jobs) {
    const n = rows.filter((r) => r.job_id === jobId).length;
    stmts.push(
      env.DB.prepare(
        "UPDATE bulk_jobs SET status = 'running', processed = processed - ?, failed = failed - ?, updated_at = datetime('now') WHERE id = ? AND merchant_id = ?"
      ).bind(n, n, jobId, merchantId)
    );
  }
  await env.DB.batch(stmts);
  return rows.length;
}

// ── المرحلة ٤: SQL كان بـ`api/store/bulk/{status,generate}.js` ──────────────

/** الصفوف الفاشلة/المتخطّاة بوظيفة — للعرض بشاشة التقدّم. */
export async function failedBulkItems(env, jobId, limit = 50) {
  // tenant-audit-ok: jobId تحقّق منه المستدعي بـgetBulkJob(jobId, merchantId)
  // قبل هذا النداء — الوظيفة نفسها هي حدّ العزل.
  const { results } = await env.DB.prepare(
    "SELECT row_index, sku, name, status, error FROM bulk_job_items WHERE job_id = ? AND status IN ('failed','skipped') ORDER BY row_index ASC LIMIT ?"
  )
    .bind(jobId, limit)
    .all();
  return results || [];
}

/**
 * يعلّم ما فوق حصة الشهر **مؤجَّلاً** فوراً بدل تركه يفشل صفاً صفاً بالـcron،
 * ويعكس ذلك على عدّادات الوظيفة (يُحيا لاحقاً بـreviveDeferredItems).
 */
export async function markDeferredItems(env, { jobId, merchantId, fromIndex, count }) {
  if (!count) return;
  // tenant-audit-ok: job_id أُنشئ للتو لهذا التاجر بـcreateBulkJob — لا مدخل عميل.
  await env.DB.prepare(
    `UPDATE bulk_job_items SET status = 'skipped', error = ?, updated_at = datetime('now')
      WHERE job_id = ? AND row_index >= ?`
  )
    .bind(DEFERRED_MARKER, jobId, fromIndex)
    .run();
  // tenant-audit-ok: نفس job_id الموثوق؛ العدّادات تعكس المؤجَّل كمعالَج/فاشل حتى يُحيا.
  await env.DB.prepare(
    "UPDATE bulk_jobs SET processed = processed + ?, failed = failed + ?, updated_at = datetime('now') WHERE id = ? AND merchant_id = ?"
  )
    .bind(count, count, jobId, merchantId)
    .run();
  // كل الصفوف مؤجَّلة (processed = total) ⇒ الوظيفة لا تبقى «جارية» للأبد فتلتحق بها كل ضغطة توليد
  // لاحقة وتعلق نافذة التقدّم على ١٠٠٪ (2026-09-14). reviveDeferredItems يعيدها running عند تجدد الحد.
  // tenant-audit-ok: نفس job_id الموثوق.
  await env.DB.prepare("UPDATE bulk_jobs SET status = 'done', updated_at = datetime('now') WHERE id = ? AND merchant_id = ? AND processed >= total")
    .bind(jobId, merchantId)
    .run();
}

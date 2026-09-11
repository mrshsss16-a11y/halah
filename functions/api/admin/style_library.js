// POST /api/admin/style_library — body: { action: "ingest", rows: [{id?, category, description, note?}] } (≤ 25 صفاً)
//                                 | { action: "count" }
// Bulk-loads real successful product descriptions (merchant-supplied) into
// the copy.js style-reference library (functions/_lib/ai/memory.js). Admin
// only — this is a one-time/occasional ingestion tool, not a merchant-facing
// endpoint.
import { withApi } from "../../_lib/core/respond.js";
import { recordAdminAction } from "../../_lib/core/auditLog.js";
import { requireAdmin } from "../../_lib/core/session.js";
import { storeStyleExample } from "../../_lib/ai/memory.js";

const MAX_ROWS_PER_BATCH = 25;

async function styleLibraryHandler(body, env, request, requestId, context) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };
  // P9 — سطر تدقيق: من قرأ/عدّل ماذا ومتى (migrations/0023 audit_log).
  recordAdminAction(context, { admin, action: String(body.action || "read"), path: new URL(request.url).pathname, targetMerchantId: body.merchantId || body.storeId || null, requestId });

  if (body.action === "ingest") {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return { ok: false, error: "لا يوجد صفوف." };
    // كل صف = تضمين + upsert + سطر D1. سقف الدفعة يُبقي الطلب تحت حد الطلبات الفرعية.
    if (rows.length > MAX_ROWS_PER_BATCH) return { ok: false, error: `الحد ${MAX_ROWS_PER_BATCH} صفاً بالدفعة.`, code: "BATCH_TOO_LARGE" };

    let inserted = 0;
    let skipped = 0;
    for (const row of rows) {
      const category = (row.category || "").toString().trim().slice(0, 100);
      const description = (row.description || "").toString().trim().slice(0, 4000);
      const note = (row.note || "").toString().trim().slice(0, 500);
      const key = (row.id || "").toString().trim();
      const refKey = /^[A-Za-z0-9_-]{1,40}$/.test(key) ? key : null;
      if (!category || !description) {
        skipped++;
        continue;
      }
      const id = await storeStyleExample({ env, category, text: description, note, refKey }).catch(() => null);
      if (id) inserted++;
      else skipped++;
    }
    return { ok: true, inserted, skipped };
  }

  return { ok: false, error: "action غير معروف." };
}

export const onRequestPost = withApi(styleLibraryHandler);

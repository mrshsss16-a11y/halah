// POST /api/admin/style_library — body: { action: "ingest", rows: [{category, description, note?}] }
//                                 | { action: "count" }
// Bulk-loads real successful product descriptions (merchant-supplied) into
// the copy.js style-reference library (functions/_lib/ai/memory.js). Admin
// only — this is a one-time/occasional ingestion tool, not a merchant-facing
// endpoint.
import { withApi } from "../../_lib/core/respond.js";
import { requireAdmin } from "../../_lib/core/session.js";
import { storeStyleExample } from "../../_lib/ai/memory.js";

async function styleLibraryHandler(body, env, request) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };

  if (body.action === "ingest") {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return { ok: false, error: "لا يوجد صفوف." };

    let inserted = 0;
    let skipped = 0;
    for (const row of rows) {
      const category = (row.category || "").toString().trim().slice(0, 100);
      const description = (row.description || "").toString().trim().slice(0, 4000);
      const note = (row.note || "").toString().trim().slice(0, 500);
      if (!category || !description) {
        skipped++;
        continue;
      }
      const id = await storeStyleExample({ env, category, text: description, note }).catch(() => null);
      if (id) inserted++;
      else skipped++;
    }
    return { ok: true, inserted, skipped };
  }

  return { ok: false, error: "action غير معروف." };
}

export const onRequestPost = withApi(styleLibraryHandler);

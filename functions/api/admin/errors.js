// POST /api/admin/errors — body: { storeId?: string, limit?: number }
// D3 (docs/PARALLEL_TRACKS.md §أ.٤): يعرض آخر الأخطاء من error_log بلا حاجة
// لـ`wrangler tail` أو لوحة Cloudflare — تشخيص لمطوّر واحد بلا أدوات خارجية.
// requireAdmin فقط: سجل الأخطاء عابر لكل المتاجر، مثل accounts.js وbookings.js.
import { withApi } from "../../_lib/core/respond.js";
import { requireAdmin } from "../../_lib/core/session.js";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

async function errorsHandler(body, env, request) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };

  const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  let query = `SELECT id, request_id, store_id, code, path, internal, created_at FROM error_log`;
  const params = [];
  if (body.storeId) {
    query += ` WHERE store_id = ?`;
    params.push(body.storeId);
  }
  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  const { results } = await env.DB.prepare(query)
    .bind(...params)
    .all();

  return { ok: true, rows: results || [] };
}

export const onRequestPost = withApi(errorsHandler);

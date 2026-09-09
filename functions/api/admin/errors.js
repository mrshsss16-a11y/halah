// POST /api/admin/errors — body: { storeId?: string, limit?: number }
// D3 (docs/PARALLEL_TRACKS.md §أ.٤): يعرض آخر الأخطاء من error_log بلا حاجة
// لـ`wrangler tail` أو لوحة Cloudflare — تشخيص لمطوّر واحد بلا أدوات خارجية.
// requireAdmin فقط: سجل الأخطاء عابر لكل المتاجر، مثل accounts.js وbookings.js.
import { withApi } from "../../_lib/core/respond.js";
import { recordAdminAction } from "../../_lib/core/auditLog.js";
import { requireAdmin } from "../../_lib/core/session.js";
import { listErrorLog } from "../../_lib/domain/analytics.js";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

async function errorsHandler(body, env, request, requestId, context) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };
  // P9 — سطر تدقيق: من قرأ/عدّل ماذا ومتى (migrations/0023 audit_log).
  recordAdminAction(context, { admin, action: String(body.action || "read"), path: new URL(request.url).pathname, targetMerchantId: body.merchantId || body.storeId || null, requestId });

  const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  return { ok: true, rows: await listErrorLog(env, { storeId: body.storeId || null, limit }) };
}

export const onRequestPost = withApi(errorsHandler);

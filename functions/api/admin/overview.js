// POST /api/admin/overview — dashboard counters only, no raw query surface.
import { withApi } from "../../_lib/core/respond.js";
import { recordAdminAction } from "../../_lib/core/auditLog.js";
import { requireAdmin } from "../../_lib/core/session.js";
import { adminStats } from "../../_lib/domain/analytics.js";

async function overviewHandler(body, env, request, requestId, context) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };
  // P9 — سطر تدقيق: من قرأ/عدّل ماذا ومتى (migrations/0023 audit_log).
  recordAdminAction(context, { admin, action: String(body.action || "read"), path: new URL(request.url).pathname, targetMerchantId: body.merchantId || body.storeId || null, requestId });
  return { ok: true, stats: await adminStats(env), email: admin.email };
}

export const onRequestPost = withApi(overviewHandler);

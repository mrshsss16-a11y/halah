// POST /api/admin/conversations — last message per phone for Aura's own WhatsApp line.
import { withApi } from "../../_lib/core/respond.js";
import { recordAdminAction } from "../../_lib/core/auditLog.js";
import { requireAdmin } from "../../_lib/core/session.js";
import { recentWaConversations } from "../../_lib/core/db.js";

async function conversationsHandler(body, env, request, requestId, context) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };
  // P9 — سطر تدقيق: من قرأ/عدّل ماذا ومتى (migrations/0023 audit_log).
  recordAdminAction(context, { admin, action: String(body.action || "read"), path: new URL(request.url).pathname, targetMerchantId: body.merchantId || body.storeId || null, requestId });
  return { ok: true, rows: await recentWaConversations(env, "hala") };
}

export const onRequestPost = withApi(conversationsHandler);

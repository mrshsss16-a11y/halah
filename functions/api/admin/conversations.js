// POST /api/admin/conversations — last message per phone for Aura's own WhatsApp line.
import { withApi } from "../../_lib/core/respond.js";
import { requireAdmin } from "../../_lib/core/session.js";
import { recentWaConversations } from "../../_lib/core/db.js";

async function conversationsHandler(body, env, request) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };
  return { ok: true, rows: await recentWaConversations(env, "hala") };
}

export const onRequestPost = withApi(conversationsHandler);

// POST /api/admin/conversations — last message per phone for Aura's own WhatsApp line.
import { withApi } from "../../_lib/respond.js";
import { requireAdmin } from "../../_lib/session.js";
import { recentWaConversations } from "../../_lib/db.js";

async function conversationsHandler(body, env, request) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };
  return { ok: true, rows: await recentWaConversations(env, "hala") };
}

export const onRequestPost = withApi(conversationsHandler);

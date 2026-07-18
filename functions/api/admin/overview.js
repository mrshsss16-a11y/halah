// POST /api/admin/overview — dashboard counters only, no raw query surface.
import { withApi } from "../../_lib/respond.js";
import { requireAdmin } from "../../_lib/session.js";
import { adminStats } from "../../_lib/db.js";

async function overviewHandler(body, env, request) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };
  return { ok: true, stats: await adminStats(env), email: admin.email };
}

export const onRequestPost = withApi(overviewHandler);

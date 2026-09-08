// POST /api/admin/accounts
// body: { action: "list" } | { action: "setDisabled", merchantId, disabled }
import { withApi } from "../../_lib/core/respond.js";
import { recordAdminAction } from "../../_lib/core/auditLog.js";
import { requireAdmin, bumpSessionVersion } from "../../_lib/core/session.js";
import { listAccounts, setAccountDisabled, resetMerchantQuota } from "../../_lib/core/db.js";

async function accountsHandler(body, env, request, requestId, context) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };
  // P9 — سطر تدقيق: من قرأ/عدّل ماذا ومتى (migrations/0023 audit_log).
  recordAdminAction(context, { admin, action: String(body.action || "read"), path: new URL(request.url).pathname, targetMerchantId: body.merchantId || body.storeId || null, requestId });

  if (body.action === "list") {
    return { ok: true, rows: await listAccounts(env) };
  }
  if (body.action === "setDisabled") {
    if (!body.merchantId) return { ok: false, error: "merchantId مفقود." };
    await setAccountDisabled(env, body.merchantId, Boolean(body.disabled));
    // P40 — disabling must cut the live session too, not just block the next login.
    if (body.disabled) await bumpSessionVersion(env, body.merchantId);
    return { ok: true };
  }
  if (body.action === "resetQuota") {
    if (!body.merchantId) return { ok: false, error: "merchantId مفقود." };
    await resetMerchantQuota(env, body.merchantId);
    return { ok: true };
  }
  return { ok: false, error: "action غير معروف." };
}

export const onRequestPost = withApi(accountsHandler);

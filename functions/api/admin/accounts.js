// POST /api/admin/accounts
// body: { action: "list" } | { action: "setDisabled", merchantId, disabled }
import { withApi } from "../../_lib/core/respond.js";
import { requireAdmin } from "../../_lib/core/session.js";
import { listAccounts, setAccountDisabled, resetMerchantQuota } from "../../_lib/core/db.js";

async function accountsHandler(body, env, request) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };

  if (body.action === "list") {
    return { ok: true, rows: await listAccounts(env) };
  }
  if (body.action === "setDisabled") {
    if (!body.merchantId) return { ok: false, error: "merchantId مفقود." };
    await setAccountDisabled(env, body.merchantId, Boolean(body.disabled));
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

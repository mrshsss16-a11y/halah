// POST /api/auth/logout — clears the cookie AND bumps accounts.session_version
// (P40): every live session of this merchant — including a stolen copy on
// another device — stops verifying. Before 0023, logout only cleared the
// browser's cookie; the token itself stayed valid for its full 30 days.
import { json } from "../../_lib/core/respond.js";
import { sessionCookieHeader, getSessionMerchantId, bumpSessionVersion } from "../../_lib/core/session.js";
import { assertTrustedWrite } from "../../_lib/core/csrf.js";
import { logError } from "../../_lib/core/errorLog.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    assertTrustedWrite(request, env);
  } catch (err) {
    return json({ ok: false, error: err.message, code: err.code || "CSRF_REJECTED" }, err.status || 403);
  }
  const merchantId = await getSessionMerchantId(request, env).catch(() => null);
  if (merchantId) {
    await bumpSessionVersion(env, merchantId).catch((e) =>
      logError(context, { requestId: null, path: "auth/logout", code: "SESSION_BUMP_FAILED", storeId: merchantId, internal: e?.message || String(e) })
    );
  }
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookieHeader("", { clear: true }) });
}

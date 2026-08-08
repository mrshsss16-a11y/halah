// POST /api/whatsapp/status — is this merchant's WhatsApp connected?
// Drives the dashboard card: show the connect button, or the connected number.
import { withApi, ApiError } from "../../_lib/core/respond.js";
import { getSessionMerchantId } from "../../_lib/core/session.js";
import { getWaConnectionByMerchant } from "../../_lib/core/db.js";

async function statusHandler(body, env, request) {
  const merchantId = await getSessionMerchantId(request, env);
  if (!merchantId) {
    throw new ApiError(401, "سجّل دخولك أولاً.", "LOGIN_REQUIRED");
  }
  const conn = await getWaConnectionByMerchant(env, merchantId);

  if (!conn || conn.status !== "active") {
    // The button can only work once Meta approves Tech Provider access and a
    // Facebook Login for Business configuration exists. Both values are public
    // by design (the app ID and login-config ID are visible in any Embedded
    // Signup implementation) — the app SECRET never leaves the server.
    const available = Boolean(env.META_APP_ID && env.WA_SIGNUP_CONFIG_ID);
    return {
      ok: true,
      connected: false,
      available,
      metaAppId: available ? env.META_APP_ID : null,
      configId: available ? env.WA_SIGNUP_CONFIG_ID : null
    };
  }

  // Never expose business_token or the raw IDs the browser has no use for.
  return {
    ok: true,
    connected: true,
    displayPhone: conn.display_phone,
    verifiedName: conn.verified_name,
    connectedAt: conn.connected_at
  };
}

export const onRequestPost = withApi(statusHandler);

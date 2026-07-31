// GET /api/auth/salla/install
// Redirects merchant to Salla OAuth consent screen with a signed CSRF state.
import { createOAuthState, oauthStateCookieHeader } from "../../../_lib/core/oauthState.js";

export async function onRequestGet(context) {
  const { env } = context;
  const clientId = env.SALLA_CLIENT_ID || env.SALLA_APP_ID;

  if (!clientId) {
    return new Response(JSON.stringify({ ok: false, error: "Missing Salla Client ID" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }

  const state = await createOAuthState(env);

  const authUrl = new URL("https://accounts.salla.sa/oauth2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "offline_access");
  authUrl.searchParams.set("state", state);

  // Response.redirect() can't carry Set-Cookie, so build the response manually.
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl.toString(),
      "Set-Cookie": oauthStateCookieHeader(state)
    }
  });
}

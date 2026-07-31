// GET /api/auth/zid/install
// Redirects merchant to Zid OAuth consent screen with a signed CSRF state.
import { createOAuthState, oauthStateCookieHeader } from "../../../_lib/core/oauthState.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const clientId = env.ZID_CLIENT_ID;
  if (!clientId) {
    return new Response(JSON.stringify({ ok: false, error: "ZID_CLIENT_ID غير مضبوط في البيئة" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }

  const state = await createOAuthState(env);

  const callbackUrl = `${url.origin}/api/auth/zid/callback`;
  const authUrl = new URL("https://oauth.zid.sa/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", callbackUrl);
  authUrl.searchParams.set("response_type", "code");
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

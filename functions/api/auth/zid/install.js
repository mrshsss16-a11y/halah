// GET /api/auth/zid/install
// Redirects merchant to Zid OAuth consent screen.
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

  const callbackUrl = `${url.origin}/api/auth/zid/callback`;
  const authUrl = new URL("https://oauth.zid.sa/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", callbackUrl);
  authUrl.searchParams.set("response_type", "code");

  return Response.redirect(authUrl.toString(), 302);
}

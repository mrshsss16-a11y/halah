// GET /api/auth/zid/callback
// Handles OAuth code → token exchange and saves tokens to D1.
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return new Response(JSON.stringify({ ok: false, error: "Missing authorization code" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }

  const clientId = env.ZID_CLIENT_ID;
  const clientSecret = env.ZID_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ ok: false, error: "ZID_CLIENT_ID أو ZID_CLIENT_SECRET غير مضبوط" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }

  try {
    const callbackUrl = `${url.origin}/api/auth/zid/callback`;

    // 1. Exchange code for tokens
    const tokenRes = await fetch("https://oauth.zid.sa/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: callbackUrl,
        grant_type: "authorization_code"
      })
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(`Token exchange failed: HTTP ${tokenRes.status} ${errText.slice(0, 200)}`);
    }

    const tokenData = await tokenRes.json();
    // Zid returns: { access_token, token_type, manager_token, store_id, ... }
    const managerToken = tokenData.manager_token ?? tokenData.access_token;
    const storeId = String(tokenData.store_id ?? tokenData.store?.id ?? "zid");
    const merchantId = storeId;

    // 2. Save tokens in D1
    const { saveTokens } = await import("../../../_lib/core/db.js");
    await saveTokens(env, {
      merchantId,
      platform: "zid",
      accessToken: managerToken,
      refreshToken: tokenData.refresh_token ?? null,
      expiresAt: Math.floor(Date.now() / 1000) + (Number(tokenData.expires_in) || 365 * 24 * 3600)
    });

    return new Response(
      JSON.stringify({ ok: true, merchantId, storeId, status: "connected" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}

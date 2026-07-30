export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const code = url.searchParams.get('code');

    if (!code) {
        return new Response(JSON.stringify({ ok: false, error: "Missing authorization code" }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
        });
    }

    const clientId = env.SALLA_CLIENT_ID || env.SALLA_APP_ID;
    const clientSecret = env.SALLA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        return new Response(JSON.stringify({ ok: false, error: "Missing Salla credentials in environment" }), {
            status: 500,
            headers: { 'content-type': 'application/json' }
        });
    }

    try {
        // 1. Exchange code for token
        const tokenResponse = await fetch("https://accounts.salla.sa/oauth2/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: "authorization_code",
                code: code,
                redirect_uri: `${url.origin}${url.pathname}`
            })
        });

        if (!tokenResponse.ok) {
            const errText = await tokenResponse.text();
            throw new Error(`Token exchange failed: ${errText}`);
        }

        const tokenData = await tokenResponse.json();

        // 2. Get merchant info to find merchantId
        const userResponse = await fetch("https://accounts.salla.sa/oauth2/user/info", {
            headers: {
                "Authorization": `Bearer ${tokenData.access_token}`
            }
        });

        if (!userResponse.ok) {
            const errText = await userResponse.text();
            throw new Error(`Failed to fetch user info: ${errText}`);
        }

        const userData = await userResponse.json();
        const merchantId = userData.data.merchant.id.toString();

        // 3. Save tokens in D1 using existing saveTokens
        const { saveTokens } = await import("../../../../_lib/core/db.js");
        
        await saveTokens(env, {
            merchantId,
            platform: "salla",
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: Math.floor(Date.now() / 1000) + (Number(tokenData.expires_in) || 14 * 24 * 3600)
        });

        // 4. Return success JSON
        return new Response(JSON.stringify({ ok: true, merchantId, status: "connected" }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500,
            headers: { 'content-type': 'application/json' }
        });
    }
}

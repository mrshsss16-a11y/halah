export async function onRequestGet(context) {
    const { env } = context;
    const clientId = env.SALLA_CLIENT_ID || env.SALLA_APP_ID;
    
    if (!clientId) {
        return new Response(JSON.stringify({ ok: false, error: "Missing Salla Client ID" }), {
            status: 500,
            headers: { 'content-type': 'application/json' }
        });
    }

    const redirectUrl = `https://accounts.salla.sa/oauth2/auth?client_id=${clientId}&response_type=code&scope=offline_access`;
    
    return Response.redirect(redirectUrl, 302);
}

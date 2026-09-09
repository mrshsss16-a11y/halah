import { verifyOAuthState, oauthStateCookieHeader } from "../../../_lib/core/oauthState.js";
import { generateRequestId } from "../../../_lib/core/respond.js";
import { logError } from "../../../_lib/core/errorLog.js";
import { createSessionToken, sessionCookieHeader } from "../../../_lib/core/session.js";

export async function onRequestGet(context) {
    const { request, env } = context;
    const requestId = generateRequestId();
    const url = new URL(request.url);
    const code = url.searchParams.get('code');

    if (!code) {
        return new Response(JSON.stringify({ ok: false, error: "لم يصلنا رمز التفويض من سلة. أعد بدء الربط من جديد.", code: "SALLA_CODE_MISSING", requestId }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
        });
    }

    // CSRF: the state must be one we signed and must match the cookie set when
    // this browser started the flow. Without it, an attacker can replay their own
    // authorization code through a victim's browser and bind their store to it.
    const stateOk = await verifyOAuthState(env, request, url.searchParams.get('state'));
    if (!stateOk) {
        return new Response(
            JSON.stringify({ ok: false, error: "فشل التحقق من صحة الطلب (state). أعد بدء الربط من جديد." }),
            { status: 400, headers: { 'content-type': 'application/json', 'Set-Cookie': oauthStateCookieHeader("", { clear: true }) } }
        );
    }

    const clientId = env.SALLA_CLIENT_ID || env.SALLA_APP_ID;
    const clientSecret = env.SALLA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        logError(context, { requestId, path: "auth/salla/callback", code: "SALLA_CREDENTIALS_MISSING", internal: "SALLA_CLIENT_ID/SECRET not configured" });
        return new Response(JSON.stringify({ ok: false, error: "الربط مع سلة غير مفعّل حالياً على الخادم. تواصل مع الدعم.", code: "SALLA_NOT_CONFIGURED", requestId }), {
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

        // Never forward `errText` in the response — it's Salla's raw API body,
        // which can (and has, in provider error responses generally) embed
        // request echoes, internal identifiers, or other data no merchant's
        // browser should render. Logged server-side only.
        if (!tokenResponse.ok) {
            const errText = await tokenResponse.text();
            throw new Error(`token_exchange_failed:${tokenResponse.status}:${errText.slice(0, 500)}`);
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
            throw new Error(`user_info_failed:${userResponse.status}:${errText.slice(0, 500)}`);
        }

        const userData = await userResponse.json();
        const sallaMerchantId = userData.data.merchant.id.toString();
        const storeName = userData.data.merchant.name || null;

        // 3. Save tokens in D1 — upsert our internal merchant row first (the
        // FK oauth_tokens.merchant_id expects our id, not Salla's raw id).
        const { saveTokens, upsertMerchantFromSalla } = await import("../../../_lib/core/db.js");
        const merchantId = await upsertMerchantFromSalla(env, { sallaMerchantId, storeName });

        await saveTokens(env, {
            merchantId,
            platform: "salla",
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: Math.floor(Date.now() / 1000) + (Number(tokenData.expires_in) || 14 * 24 * 3600)
        });

        // 4. Establish our own session (same pattern as auth/salla_embedded.js)
        // and redirect the merchant straight into the dashboard, instead of
        // dumping raw JSON on the browser after a successful link.
        const sessionToken = await createSessionToken(env, merchantId);
        const headers = new Headers({ 'Location': '/dashboard?connected=1', 'content-type': 'text/plain' });
        headers.append('Set-Cookie', sessionCookieHeader(sessionToken));
        headers.append('Set-Cookie', oauthStateCookieHeader("", { clear: true }));
        return new Response(null, { status: 302, headers });

    } catch (error) {
        // error.message here is our own classified string ("token_exchange_failed:…")
        // built above — never the merchant's-eyes-view text. That view stays fixed
        // and Arabic; the detail goes to the log only.
        logError(context, { requestId, path: "auth/salla/callback", code: "SALLA_OAUTH_FAILED", internal: error.message });
        return new Response(JSON.stringify({ ok: false, error: "تعذر إكمال الربط مع سلة. حاول مرة ثانية، ولو تكرر تواصل معنا.", code: "SALLA_OAUTH_FAILED", requestId }), {
            status: 502,
            headers: { 'content-type': 'application/json' }
        });
    }
}

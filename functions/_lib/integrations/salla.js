// Salla Merchant API client.
// Base: https://api.salla.dev/admin/v2/ with Authorization: Bearer <token>.
// Access tokens live 14 days; refresh tokens are SINGLE-USE and parallel
// refreshes revoke the whole authorization (forces app re-install), so the
// refresh path is guarded by the D1 refresh_lock mutex from db.js.
import { getTokens, saveTokens, acquireRefreshLock, releaseRefreshLock } from "../core/db.js";

const API_BASE = "https://api.salla.dev/admin/v2";
const TOKEN_URL = "https://accounts.salla.sa/oauth2/token";
const REFRESH_MARGIN_S = 24 * 3600; // renew when less than a day remains

async function refreshTokens(env, merchantId, tokens) {
  const won = await acquireRefreshLock(env, merchantId, "salla");
  if (!won) {
    // Another request is refreshing — wait briefly, then re-read.
    await new Promise((r) => setTimeout(r, 1500));
    const fresh = await getTokens(env, merchantId, "salla");
    if (fresh && fresh.expires_at * 1000 > Date.now()) return fresh;
    throw new Error("token refresh in progress elsewhere; retry shortly");
  }
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: env.SALLA_CLIENT_ID,
        client_secret: env.SALLA_CLIENT_SECRET
      })
    });
    if (!res.ok) {
      throw new Error(`salla token refresh failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    await saveTokens(env, {
      merchantId,
      platform: "salla",
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Math.floor(Date.now() / 1000) + (Number(data.expires_in) || 14 * 24 * 3600)
    });
    return getTokens(env, merchantId, "salla");
  } finally {
    await releaseRefreshLock(env, merchantId, "salla").catch(() => {});
  }
}

async function getValidToken(env, merchantId) {
  let tokens = await getTokens(env, merchantId, "salla");
  if (!tokens) {
    throw new Error("المتجر غير مرتبط بسلة — ثبّت التطبيق من متجر سلة أولاً.");
  }
  const now = Math.floor(Date.now() / 1000);
  if (tokens.expires_at - now < REFRESH_MARGIN_S) {
    tokens = await refreshTokens(env, merchantId, tokens);
  }
  return tokens.access_token;
}

export async function sallaFetch(env, merchantId, path, opts = {}) {
  const token = await getValidToken(env, merchantId);
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(opts.headers || {})
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`salla API ${path}: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

export async function listProducts(env, merchantId, page = 1) {
  return sallaFetch(env, merchantId, `/products?page=${page}&per_page=20`);
}

export async function updateProduct(env, merchantId, productId, fields) {
  return sallaFetch(env, merchantId, `/products/${productId}`, {
    method: "PUT",
    body: JSON.stringify(fields)
  });
}

export async function listOrders(env, merchantId, page = 1) {
  return sallaFetch(env, merchantId, `/orders?page=${page}&per_page=10`);
}

// Zid Merchant API client.
// Base: https://api.zid.sa/v1 with dual-header auth:
//   Authorization: Bearer {ZID_APP_TOKEN}  (fixed app token from env)
//   X-Manager-Token: {manager_token}       (per-store token from D1)
// Zid tokens do NOT expire automatically — they persist until revoked.
import { getTokens, saveTokens } from "../core/db.js";

const API_BASE = "https://api.zid.sa/v1";
const OAUTH_TOKEN_URL = "https://oauth.zid.sa/oauth/token";

// ── Core API Fetcher ──────────────────────────────────────
export async function zidFetch(env, merchantId, path, opts = {}) {
  const tokens = await getTokens(env, merchantId, "zid");
  if (!tokens) {
    throw new Error("المتجر غير مرتبط بزد — ثبّت التطبيق من متجر زد أولاً.");
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Authorization": `Bearer ${env.ZID_APP_TOKEN ?? ""}`,
      "X-Manager-Token": tokens.access_token,
      "Content-Type": "application/json",
      "Accept": "application/json",
      ...(opts.headers || {})
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`zid API ${path}: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ── OAuth Token Exchange ──────────────────────────────────
export async function exchangeZidCode(env, { code, redirectUri }) {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.ZID_CLIENT_ID,
      client_secret: env.ZID_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`zid token exchange failed: ${err.slice(0, 200)}`);
  }
  return res.json();
}

// ── Store Info ────────────────────────────────────────────
export async function getZidStore(env, merchantId) {
  return zidFetch(env, merchantId, "/managers/me/store");
}

// ── Products ──────────────────────────────────────────────
export async function getZidProducts(env, merchantId, page = 1) {
  return zidFetch(env, merchantId, `/products?page=${page}&per_page=20`);
}

export async function updateZidProduct(env, merchantId, productId, fields) {
  return zidFetch(env, merchantId, `/products/${productId}`, {
    method: "PUT",
    body: JSON.stringify(fields)
  });
}

// ── Orders ────────────────────────────────────────────────
export async function getZidOrders(env, merchantId, page = 1) {
  return zidFetch(env, merchantId, `/managers/me/orders?page=${page}&per_page=10`);
}

// ── Abandoned Carts ───────────────────────────────────────
export async function getZidAbandonedCarts(env, merchantId, page = 1) {
  return zidFetch(env, merchantId, `/managers/me/abandoned-carts?page=${page}&per_page=20`);
}

// ── Customers ─────────────────────────────────────────────
export async function getZidCustomers(env, merchantId, page = 1) {
  return zidFetch(env, merchantId, `/managers/me/customers?page=${page}&per_page=20`);
}

// ── Webhooks Management ───────────────────────────────────
export async function registerZidWebhook(env, merchantId, { event, url }) {
  return zidFetch(env, merchantId, "/webhooks", {
    method: "POST",
    body: JSON.stringify({ event, url })
  });
}

export async function listZidWebhooks(env, merchantId) {
  return zidFetch(env, merchantId, "/webhooks");
}

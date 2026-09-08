// Salla Merchant API client.
// Base: https://api.salla.dev/admin/v2/ with Authorization: Bearer <token>.
// Access tokens live 14 days; refresh tokens are SINGLE-USE and parallel
// refreshes revoke the whole authorization (forces app re-install), so the
// refresh path is guarded by the D1 refresh_lock mutex from db.js.
import { getTokens, saveTokens, acquireRefreshLock, releaseRefreshLock } from "../core/db.js";

const API_BASE = "https://api.salla.dev/admin/v2";
const TOKEN_URL = "https://accounts.salla.sa/oauth2/token";
const REFRESH_MARGIN_S = 24 * 3600; // renew when less than a day remains

// SSRF: `path` يُبنى أحياناً من قيم خارجية (معرّف منتج من D1 أو من ويبهوك سلة).
// المضيف مثبَّت هنا لأن `API_BASE` ثابت، لكن التثبيت الصريح يمنع أي تمرير مستقبلي
// لمسار مطلق (`https://evil/...`) من تحويل الوجهة قبل لصق توكن التاجر.
const SALLA_ALLOWED_HOSTS = new Set(["api.salla.dev", "accounts.salla.sa"]);

/** fail closed: يرمي قبل بناء ترويسة Authorization — لا يُرسَل التوكن إطلاقاً. */
export function assertSallaUrlAllowed(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    throw new Error("رابط سلة غير صالح — رُفض قبل إرسال أي بيانات اعتماد.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`مخطط غير مسموح (${parsed.protocol}) — رُفض قبل إرسال التوكن.`);
  }
  if (!SALLA_ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`مضيف غير مسموح (${parsed.hostname}) — رُفض قبل إرسال توكن التاجر.`);
  }
  return parsed.toString();
}

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
    const res = await fetch(assertSallaUrlAllowed(TOKEN_URL), {
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
  // التحقق أولاً — قبل حتى جلب/تجديد التوكن.
  const url = assertSallaUrlAllowed(`${API_BASE}${path}`);
  const token = await getValidToken(env, merchantId);
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(opts.headers || {})
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`salla API ${path}: HTTP ${res.status} ${body.slice(0, 200)}`);
    // مصنَّف للمستدعين: ٤٢٩ يحمل Retry-After (توثيق سلة doc-421125) حتى يوقف
    // النشر الجماعي التِك كاملاً بدل التخمين من نص الرسالة.
    err.status = res.status;
    const ra = Number(res.headers.get("Retry-After"));
    err.retryAfter = Number.isFinite(ra) && ra > 0 ? ra : null;
    err.rateLimitRemaining = res.headers.get("X-RateLimit-Remaining");
    throw err;
  }
  return res.json();
}

export async function listProducts(env, merchantId, page = 1) {
  // 60 is Salla's documented max per_page — cuts full-catalog sync requests
  // to a third versus the old default of 20 (docs/ROADMAP.md B3 design notes).
  return sallaFetch(env, merchantId, `/products?page=${page}&per_page=60`);
}

export async function updateProduct(env, merchantId, productId, fields) {
  return sallaFetch(env, merchantId, `/products/${productId}`, {
    method: "PUT",
    body: JSON.stringify(fields)
  });
}

// PUT /products/sku/{sku} — updates by SKU directly, halving request count
// versus list-then-update-by-id for bulk jobs (B3). Salla's real limit is a
// 1 req/sec leak bucket across all plan tiers, not the advertised per-minute
// numbers — callers MUST space these out themselves (see cron/bulk_process.js).
export async function updateProductBySku(env, merchantId, sku, fields) {
  return sallaFetch(env, merchantId, `/products/sku/${encodeURIComponent(sku)}`, {
    method: "PUT",
    body: JSON.stringify(fields)
  });
}

export async function listOrders(env, merchantId, page = 1) {
  return sallaFetch(env, merchantId, `/orders?page=${page}&per_page=10`);
}

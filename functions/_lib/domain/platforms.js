// مجال المنصات الأخرى وسجل الويبهوك: اتصالات `platform_connections`
// (مسار قديم لمنصات غير سلة)، السلال المتروكة، وسجل الويبهوك الخام.
// نُقل من core/db.js بالمرحلة ٣ بلا تغيير سلوكي.
import { encryptSecret, decryptSecret } from "../core/crypto.js";
import { logError } from "../core/errorLog.js";

export async function logWebhook(env, { platform, event, merchantId, payload, signatureOk }) {
  try {
    await env.DB.prepare(
      "INSERT INTO webhook_log (platform, event, merchant_id, payload, signature_ok) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(platform, event || null, merchantId || null, JSON.stringify(payload).slice(0, 8000), signatureOk ? 1 : 0)
      .run();
  } catch (err) {
    logError({ env }, { requestId: null, path: "core/db.logWebhook", code: "DB_LOG_WEBHOOK_FAILED", internal: err?.message });
  }
}

export async function saveAbandonedCart(env, { id, merchantId, customerName, customerPhone, items, total }) {
  await env.DB.prepare(
    `INSERT INTO abandoned_carts (id, merchant_id, customer_name, customer_phone, items_json, total)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       items_json = excluded.items_json, total = excluded.total
     WHERE abandoned_carts.merchant_id = excluded.merchant_id`
  )
    .bind(id, merchantId, customerName || null, customerPhone || null, JSON.stringify(items || []), total || 0)
    .run();
}

export async function listAbandonedCarts(env, merchantId, status = "open") {
  const { results } = await env.DB.prepare(
    "SELECT * FROM abandoned_carts WHERE merchant_id = ? AND status = ? ORDER BY created_at DESC LIMIT 50"
  )
    .bind(merchantId, status)
    .all();
  return results || [];
}

// platform_connections.api_key/api_secret are encrypted at rest (see
// functions/_lib/core/crypto.js) — decrypt on the way out so callers keep
// working with plaintext credentials exactly as before.
export async function getPlatformConnection(env, merchantId, platform) {
  const row = await env.DB.prepare("SELECT * FROM platform_connections WHERE merchant_id = ? AND platform = ?")
    .bind(merchantId, platform)
    .first();
  if (!row) return null;
  return {
    ...row,
    api_key: await decryptSecret(env, row.api_key),
    api_secret: await decryptSecret(env, row.api_secret)
  };
}

export async function savePlatformConnection(env, { merchantId, platform, sellerId, apiKey, apiSecret, environment, storeName }) {
  const encApiKey = await encryptSecret(env, apiKey);
  const encApiSecret = await encryptSecret(env, apiSecret);
  await env.DB.prepare(
    `INSERT INTO platform_connections (merchant_id, platform, seller_id, api_key, api_secret, environment, store_name)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (merchant_id, platform) DO UPDATE SET
       seller_id = excluded.seller_id,
       api_key = excluded.api_key,
       api_secret = excluded.api_secret,
       environment = excluded.environment,
       store_name = COALESCE(excluded.store_name, store_name),
       connected_at = datetime('now')`
  )
    .bind(merchantId, platform, sellerId, encApiKey, encApiSecret, environment || "prod", storeName || null)
    .run();
}

// ── المرحلة ٤: SQL كان بـ`api/store/overview.js` ────────────────────────────

/** منتجات متجر مُزامَنة من منصة خارجية (Trendyol اليوم) — الأحدث أولاً. */
export async function listSyncedProducts(env, merchantId, platform, limit = 20) {
  const { results } = await env.DB.prepare(
    `SELECT external_id, title, price, stock, sync_status, last_sync_at
       FROM product_sync WHERE merchant_id = ? AND platform = ?
       ORDER BY last_sync_at DESC LIMIT ?`
  )
    .bind(merchantId, platform, limit)
    .all();
  return results || [];
}

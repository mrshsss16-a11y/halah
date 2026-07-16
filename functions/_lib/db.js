// Unified D1 access layer (binding: DB → halah-tr-db). All queries live here —
// endpoints never write raw SQL. merchants.id is the canonical storeId.

export async function getMerchant(env, merchantId) {
  return env.DB.prepare("SELECT * FROM merchants WHERE id = ?").bind(merchantId).first();
}

export async function getMerchantBySalla(env, sallaMerchantId) {
  return env.DB.prepare("SELECT * FROM merchants WHERE salla_merchant_id = ?")
    .bind(String(sallaMerchantId))
    .first();
}

export async function upsertMerchantFromSalla(env, { sallaMerchantId, storeName }) {
  const existing = await getMerchantBySalla(env, sallaMerchantId);
  if (existing) {
    if (storeName && storeName !== existing.store_name) {
      await env.DB.prepare("UPDATE merchants SET store_name = ? WHERE id = ?")
        .bind(storeName, existing.id)
        .run();
    }
    return existing.id;
  }
  const id = `m_${crypto.randomUUID().slice(0, 12)}`;
  await env.DB.prepare(
    "INSERT INTO merchants (id, salla_merchant_id, store_name) VALUES (?, ?, ?)"
  )
    .bind(id, String(sallaMerchantId), storeName || null)
    .run();
  return id;
}

export async function saveTokens(env, { merchantId, platform, accessToken, refreshToken, expiresAt }) {
  await env.DB.prepare(
    `INSERT INTO oauth_tokens (merchant_id, platform, access_token, refresh_token, expires_at, refresh_lock, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
     ON CONFLICT (merchant_id, platform) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       refresh_lock = 0,
       updated_at = datetime('now')`
  )
    .bind(merchantId, platform, accessToken, refreshToken, expiresAt)
    .run();
}

export async function getTokens(env, merchantId, platform) {
  return env.DB.prepare("SELECT * FROM oauth_tokens WHERE merchant_id = ? AND platform = ?")
    .bind(merchantId, platform)
    .first();
}

/**
 * Try to acquire the refresh mutex. Returns true when this caller won and
 * must perform the refresh; false when another request holds the lock.
 * Stale locks (>60s old) are stealable to survive crashed refreshes.
 */
export async function acquireRefreshLock(env, merchantId, platform) {
  const result = await env.DB.prepare(
    `UPDATE oauth_tokens SET refresh_lock = 1, updated_at = datetime('now')
     WHERE merchant_id = ? AND platform = ?
       AND (refresh_lock = 0 OR updated_at < datetime('now', '-60 seconds'))`
  )
    .bind(merchantId, platform)
    .run();
  return result.meta.changes > 0;
}

export async function releaseRefreshLock(env, merchantId, platform) {
  await env.DB.prepare(
    "UPDATE oauth_tokens SET refresh_lock = 0 WHERE merchant_id = ? AND platform = ?"
  )
    .bind(merchantId, platform)
    .run();
}

export async function logWebhook(env, { platform, event, merchantId, payload, signatureOk }) {
  await env.DB.prepare(
    "INSERT INTO webhook_log (platform, event, merchant_id, payload, signature_ok) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(platform, event || null, merchantId || null, JSON.stringify(payload).slice(0, 8000), signatureOk ? 1 : 0)
    .run();
}

export async function saveAbandonedCart(env, { id, merchantId, customerName, customerPhone, items, total }) {
  await env.DB.prepare(
    `INSERT INTO abandoned_carts (id, merchant_id, customer_name, customer_phone, items_json, total)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       items_json = excluded.items_json, total = excluded.total`
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

export async function getMarketingContext(env, merchantId) {
  return env.DB.prepare("SELECT * FROM marketing_contexts WHERE merchant_id = ?")
    .bind(merchantId)
    .first();
}

export async function saveMarketingContext(env, merchantId, { dialect, instructions }) {
  await env.DB.prepare(
    `INSERT INTO marketing_contexts (merchant_id, dialect, instructions, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (merchant_id) DO UPDATE SET
       dialect = COALESCE(excluded.dialect, dialect),
       instructions = COALESCE(excluded.instructions, instructions),
       updated_at = datetime('now')`
  )
    .bind(merchantId, dialect || null, instructions || null)
    .run();
}

export async function getPlatformConnection(env, merchantId, platform) {
  return env.DB.prepare("SELECT * FROM platform_connections WHERE merchant_id = ? AND platform = ?")
    .bind(merchantId, platform)
    .first();
}

export async function savePlatformConnection(env, { merchantId, platform, sellerId, apiKey, apiSecret, environment, storeName }) {
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
    .bind(merchantId, platform, sellerId, apiKey, apiSecret, environment || "prod", storeName || null)
    .run();
}

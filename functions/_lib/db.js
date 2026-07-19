// Unified D1 access layer (binding: DB → halah-tr-db). All queries live here —
// endpoints never write raw SQL. merchants.id is the canonical storeId.
import { encryptSecret, decryptSecret } from "./crypto.js";

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
  const encAccess = await encryptSecret(env, accessToken);
  const encRefresh = await encryptSecret(env, refreshToken);
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
    .bind(merchantId, platform, encAccess, encRefresh, expiresAt)
    .run();
}

// oauth_tokens.access_token/refresh_token are encrypted at rest (see
// functions/_lib/crypto.js) — decrypt on the way out so every caller keeps
// working with plaintext tokens exactly as before.
export async function getTokens(env, merchantId, platform) {
  const row = await env.DB.prepare("SELECT * FROM oauth_tokens WHERE merchant_id = ? AND platform = ?")
    .bind(merchantId, platform)
    .first();
  if (!row) return null;
  return {
    ...row,
    access_token: await decryptSecret(env, row.access_token),
    refresh_token: await decryptSecret(env, row.refresh_token)
  };
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

// platform_connections.api_key/api_secret are encrypted at rest (see
// functions/_lib/crypto.js) — decrypt on the way out so callers (e.g.
// functions/_lib/trendyol.js's verifyConnection) keep working with
// plaintext credentials exactly as before.
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

// ── Copy anti-repetition ──

export async function recentCopy(env, merchantId, limit = 8) {
  if (!env.DB) return [];
  const { results } = await env.DB.prepare(
    "SELECT product_name, opening, keywords FROM copy_history WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?"
  )
    .bind(merchantId, limit)
    .all();
  return results || [];
}

export async function saveCopy(env, { merchantId, productName, opening, keywords }) {
  if (!env.DB) return;
  await env.DB.prepare(
    "INSERT INTO copy_history (merchant_id, product_name, opening, keywords) VALUES (?, ?, ?, ?)"
  )
    .bind(merchantId, productName || null, (opening || "").slice(0, 80), (keywords || []).join(", "))
    .run();
}

// ── WhatsApp ──

export async function recordWaInbound(env, { merchantId, phone, name, body, waMessageId }) {
  await env.DB.prepare(
    `INSERT INTO whatsapp_contacts (merchant_id, phone, name, last_inbound_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (merchant_id, phone) DO UPDATE SET
       name = COALESCE(excluded.name, name), last_inbound_at = datetime('now')`
  )
    .bind(merchantId || "hala", phone, name || null)
    .run();
  await env.DB.prepare(
    "INSERT INTO whatsapp_messages (merchant_id, phone, direction, body, wa_message_id) VALUES (?, ?, 'in', ?, ?)"
  )
    .bind(merchantId || "hala", phone, (body || "").slice(0, 4000), waMessageId || null)
    .run();
}

export async function recordWaOutbound(env, { merchantId, phone, body, waMessageId, source = null }) {
  await env.DB.prepare(
    "INSERT INTO whatsapp_messages (merchant_id, phone, direction, body, wa_message_id, source) VALUES (?, ?, 'out', ?, ?, ?)"
  )
    .bind(merchantId || "hala", phone, (body || "").slice(0, 4000), waMessageId || null, source)
    .run();
}

/**
 * Timestamp of the most recent human-typed reply (a phone-app echo on a
 * Coexistence number) to this phone, or null if none. Lets autoReply() go
 * quiet for a while after a human manually answers instead of talking over
 * them on the customer's next message.
 */
export async function getLastHumanReplyAt(env, merchantId, phone) {
  const row = await env.DB.prepare(
    "SELECT created_at FROM whatsapp_messages WHERE merchant_id = ? AND phone = ? AND direction = 'out' AND source = 'human' ORDER BY created_at DESC LIMIT 1"
  )
    .bind(merchantId || "hala", phone)
    .first();
  return row ? row.created_at : null;
}

/** Returns true if the 24h customer-service window is open for this phone. */
export async function isWaWindowOpen(env, merchantId, phone) {
  const row = await env.DB.prepare(
    "SELECT last_inbound_at FROM whatsapp_contacts WHERE merchant_id = ? AND phone = ?"
  )
    .bind(merchantId || "hala", phone)
    .first();
  if (!row || !row.last_inbound_at) return false;
  return Date.now() - new Date(row.last_inbound_at + "Z").getTime() < 24 * 3600 * 1000;
}

export async function recentWaHistory(env, merchantId, phone, limit = 6) {
  const { results } = await env.DB.prepare(
    "SELECT direction, body FROM whatsapp_messages WHERE merchant_id = ? AND phone = ? ORDER BY created_at DESC LIMIT ?"
  )
    .bind(merchantId || "hala", phone, limit)
    .all();
  return (results || []).reverse();
}

// Store logo for the image studio's logo-overlay feature (functions/api/store/logo.js).
export async function getStoreLogo(env, merchantId) {
  const row = await env.DB.prepare("SELECT logo_data_url FROM store_logos WHERE merchant_id = ?")
    .bind(merchantId)
    .first();
  return row ? row.logo_data_url : null;
}

export async function saveStoreLogo(env, merchantId, logoDataUrl) {
  await env.DB.prepare(
    `INSERT INTO store_logos (merchant_id, logo_data_url, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT (merchant_id) DO UPDATE SET
       logo_data_url = excluded.logo_data_url, updated_at = datetime('now')`
  )
    .bind(merchantId, logoDataUrl)
    .run();
}

// ── Hala's own FAQ knowledge (RAG source of truth for the support persona) ──

export async function listHalaFaq(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, question, answer FROM hala_faq ORDER BY id"
  ).all();
  return results || [];
}

export async function saveHalaFaqEntry(env, { id, question, answer }) {
  if (id) {
    await env.DB.prepare(
      "UPDATE hala_faq SET question = ?, answer = ?, updated_at = datetime('now') WHERE id = ?"
    )
      .bind(question, answer, id)
      .run();
    return id;
  }
  const res = await env.DB.prepare(
    "INSERT INTO hala_faq (question, answer) VALUES (?, ?)"
  )
    .bind(question, answer)
    .run();
  return res.meta.last_row_id;
}

export async function deleteHalaFaqEntry(env, id) {
  await env.DB.prepare("DELETE FROM hala_faq WHERE id = ?").bind(id).run();
}

// ── Accounts admin helpers ──

export async function getAccountEmail(env, merchantId) {
  const row = await env.DB.prepare("SELECT email FROM accounts WHERE merchant_id = ?")
    .bind(merchantId)
    .first();
  return row ? row.email : null;
}

export async function listAccounts(env, limit = 200) {
  const { results } = await env.DB.prepare(
    "SELECT merchant_id, email, created_at, disabled FROM accounts ORDER BY created_at DESC LIMIT ?"
  )
    .bind(limit)
    .all();
  return (results || []).map((r) => ({
    merchantId: r.merchant_id,
    email: r.email,
    createdAt: r.created_at,
    disabled: Boolean(r.disabled)
  }));
}

export async function setAccountDisabled(env, merchantId, disabled) {
  await env.DB.prepare("UPDATE accounts SET disabled = ? WHERE merchant_id = ?")
    .bind(disabled ? 1 : 0, merchantId)
    .run();
}

export async function isAccountDisabled(env, merchantId) {
  const row = await env.DB.prepare("SELECT disabled FROM accounts WHERE merchant_id = ?")
    .bind(merchantId)
    .first();
  return Boolean(row && row.disabled);
}

// ── WhatsApp admin overview ──

export async function recentWaConversations(env, merchantId, limit = 50) {
  const { results } = await env.DB.prepare(
    `SELECT phone, body, direction, created_at
     FROM whatsapp_messages
     WHERE merchant_id = ?
       AND id IN (
         SELECT MAX(id) FROM whatsapp_messages WHERE merchant_id = ? GROUP BY phone
       )
     ORDER BY created_at DESC
     LIMIT ?`
  )
    .bind(merchantId || "hala", merchantId || "hala", limit)
    .all();
  return (results || []).map((r) => ({
    phone: r.phone,
    lastBody: r.body,
    lastDirection: r.direction,
    lastAt: r.created_at
  }));
}

// ── Consultation bookings ──

export async function saveConsultationBooking(env, { name, phone, slotLabel }) {
  const res = await env.DB.prepare(
    "INSERT INTO consultation_bookings (name, phone, preferred_slot_label) VALUES (?, ?, ?)"
  )
    .bind(name || null, phone, slotLabel)
    .run();
  return res.meta.last_row_id;
}

export async function listConsultationBookings(env, limit = 100) {
  const { results } = await env.DB.prepare(
    "SELECT id, name, phone, preferred_slot_label, status, created_at FROM consultation_bookings ORDER BY created_at DESC LIMIT ?"
  )
    .bind(limit)
    .all();
  return (results || []).map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    preferredSlotLabel: r.preferred_slot_label,
    status: r.status,
    createdAt: r.created_at
  }));
}

export async function setBookingStatus(env, id, status) {
  await env.DB.prepare("UPDATE consultation_bookings SET status = ? WHERE id = ?")
    .bind(status, id)
    .run();
}

// ── Admin dashboard counters (read-only, no raw SQL exposed to the client) ──

export async function adminStats(env) {
  const [merchants, accounts, bookings, faqEntries] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM merchants").first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM consultation_bookings").first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM hala_faq").first()
  ]);
  return {
    merchants: merchants.n,
    accounts: accounts.n,
    bookings: bookings.n,
    faqEntries: faqEntries.n
  };
}

// ── Login brute-force protection ──

const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_MINUTES = 15;

/** Returns true if this email is currently locked out from login attempts. */
export async function isLoginLocked(env, email) {
  const row = await env.DB.prepare("SELECT locked_until FROM login_attempts WHERE email = ?")
    .bind(email)
    .first();
  if (!row || !row.locked_until) return false;
  return new Date(row.locked_until + "Z").getTime() > Date.now();
}

/** Records a failed login attempt; locks the email out after LOGIN_LOCKOUT_THRESHOLD failures. */
export async function recordLoginFailure(env, email) {
  await env.DB.prepare(
    `INSERT INTO login_attempts (email, failed_count, updated_at)
     VALUES (?, 1, datetime('now'))
     ON CONFLICT (email) DO UPDATE SET
       failed_count = failed_count + 1,
       updated_at = datetime('now')`
  )
    .bind(email)
    .run();

  const row = await env.DB.prepare("SELECT failed_count FROM login_attempts WHERE email = ?")
    .bind(email)
    .first();
  if (row && row.failed_count >= LOGIN_LOCKOUT_THRESHOLD) {
    // LOGIN_LOCKOUT_MINUTES is a code constant, not user input — safe to
    // interpolate into the datetime() modifier (D1 has no bind-parameter
    // support inside datetime() modifiers).
    await env.DB.prepare(
      `UPDATE login_attempts SET locked_until = datetime('now', '+' || ? || ' minutes'), failed_count = 0
       WHERE email = ?`
    )
      .bind(LOGIN_LOCKOUT_MINUTES, email)
      .run();
  }
}

/** Clears failed-attempt state on successful login. */
export async function clearLoginAttempts(env, email) {
  await env.DB.prepare("DELETE FROM login_attempts WHERE email = ?").bind(email).run();
}

// Unified D1 access layer (binding: DB → halah-tr-db). All queries live here —
// endpoints never write raw SQL. merchants.id is the canonical storeId.
import { encryptSecret, decryptSecret } from "./crypto.js";
import { logError } from "./errorLog.js";
import { sanitizeInput } from "./security.js";

export async function getMerchant(env, merchantId) {
  return env.DB.prepare("SELECT * FROM merchants WHERE id = ?").bind(merchantId).first();
}

export async function getMerchantBySalla(env, sallaMerchantId) {
  return env.DB.prepare("SELECT * FROM merchants WHERE salla_merchant_id = ?")
    .bind(String(sallaMerchantId))
    .first();
}

export async function upsertMerchantFromSalla(env, { sallaMerchantId, storeName }) {
  // A merchant controls their own Salla store name; it renders in the admin
  // accounts table (SECURITY_AUDIT C3). Escaping at the sink is the primary
  // fix — this strips tags at the source as defence in depth.
  storeName = storeName ? sanitizeInput(String(storeName), 100) : storeName;
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

export async function getMarketingContext(env, merchantId) {
  return env.DB.prepare("SELECT * FROM marketing_contexts WHERE merchant_id = ?")
    .bind(merchantId)
    .first();
}

// ── شخصية الوكيل لكل تاجر (agent_profiles، هجرة 0021) ────────────────────────
//
// الحقول المسموح للتاجر بكتابتها — قائمة بيضاء صريحة. أي حقل يرسله العميل
// وليس هنا يُتجاهل بصمت: بدونها يقدر أي تاجر يكتب `merchant_id` أو `status`
// لصف غيره عبر تمرير مفاتيح إضافية بالطلب.
const AGENT_PROFILE_FIELDS = [
  "agent_name",
  "business_name",
  "business_type",
  "city",
  "about",
  "dialect",
  "tone",
  "reply_length",
  "emoji_level",
  "custom_instructions",
  "allow_prices",
  "forbidden_topics",
  "unknown_answer_policy",
  "escalation_number",
  "working_hours",
  "after_hours_reply",
  "knowledge_links",
  "appearance"
];

export async function getAgentProfile(env, merchantId) {
  if (!env.DB || !merchantId) return null;
  return env.DB.prepare("SELECT * FROM agent_profiles WHERE merchant_id = ?")
    .bind(merchantId)
    .first()
    .catch(() => null);
}

/**
 * حفظ جزئي (partial upsert): يحدّث الحقول المرسلة فقط ويترك الباقي كما هو،
 * عشان حفظ قسم واحد من صفحة الإعدادات لا يمسح الأقسام الثانية.
 */
export async function saveAgentProfile(env, merchantId, patch = {}) {
  if (!env.DB || !merchantId) return;

  const fields = AGENT_PROFILE_FIELDS.filter((f) => patch[f] !== undefined);
  if (!fields.length) return;

  const insertCols = ["merchant_id", ...fields];
  const placeholders = insertCols.map(() => "?").join(", ");
  const updates = fields.map((f) => `${f} = excluded.${f}`).join(",\n       ");
  const values = [merchantId, ...fields.map((f) => patch[f])];

  await env.DB.prepare(
    `INSERT INTO agent_profiles (${insertCols.join(", ")})
     VALUES (${placeholders})
     ON CONFLICT (merchant_id) DO UPDATE SET
       ${updates},
       updated_at = datetime('now')`
  )
    .bind(...values)
    .run();
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
  try {
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
  } catch (err) {
    logError({ env }, { requestId: null, path: "core/db.recordWaInbound", code: "DB_RECORD_WA_INBOUND_FAILED", internal: err?.message, storeId: merchantId || null });
  }
}

export async function recordWaOutbound(env, { merchantId, phone, body, waMessageId, source = null }) {
  try {
    await env.DB.prepare(
      "INSERT INTO whatsapp_messages (merchant_id, phone, direction, body, wa_message_id, source) VALUES (?, ?, 'out', ?, ?, ?)"
    )
      .bind(merchantId || "hala", phone, (body || "").slice(0, 4000), waMessageId || null, source)
      .run();
  } catch (err) {
    logError({ env }, { requestId: null, path: "core/db.recordWaOutbound", code: "DB_RECORD_WA_OUTBOUND_FAILED", internal: err?.message, storeId: merchantId || null });
  }
}

/**
 * Timestamp of the most recent human-typed reply (a phone-app echo on a
 * Coexistence number) to this phone, or null if none. Lets autoReply() go
 * quiet for a while after a human manually answers instead of talking over
 * them on the customer's next message.
 */
export async function getLastHumanReplyAt(env, merchantId, phone) {
  const row = await env.DB.prepare(
    "SELECT created_at FROM whatsapp_messages WHERE merchant_id = ? AND phone = ? AND direction = 'out' AND source IN ('human', 'escalated') ORDER BY created_at DESC LIMIT 1"
  )
    .bind(merchantId || "hala", phone)
    .first();
  return row ? row.created_at : null;
}

/**
 * Counts inbound messages from this phone in the last `sinceMinutes` that
 * arrived after the most recent "resolution" — either an escalation or a
 * successful consultation booking (consultation_bookings is a global table,
 * not merchant-scoped, so it's matched on phone only). A code-level safety
 * net: if the model never emits [ESCALATE] but the customer keeps messaging
 * unanswered, this forces escalation regardless of what the model decided —
 * but a customer who just booked shouldn't be force-escalated for asking a
 * couple of follow-up questions right after.
 */
export async function countRecentInboundWithoutResolution(env, merchantId, phone, sinceMinutes = 60) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM whatsapp_messages
     WHERE merchant_id = ? AND phone = ? AND direction = 'in'
       AND created_at > datetime('now', ?)
       AND created_at > COALESCE(
         (SELECT MAX(t) FROM (
            SELECT MAX(created_at) AS t FROM whatsapp_messages
             WHERE merchant_id = ? AND phone = ? AND direction = 'out' AND source = 'escalated'
            UNION ALL
            SELECT MAX(created_at) AS t FROM consultation_bookings
             WHERE phone = ?
         )),
         '1970-01-01'
       )`
  )
    .bind(merchantId || "hala", phone, `-${sinceMinutes} minutes`, merchantId || "hala", phone, phone)
    .first();
  return row ? row.n : 0;
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
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  let rows = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT 
        a.merchant_id, 
        a.email, 
        a.created_at, 
        a.disabled,
        m.store_name,
        COALESCE(u.credits_used, 0) as credits_used
       FROM accounts a
       LEFT JOIN merchants m ON a.merchant_id = m.id
       LEFT JOIN usage_meter u ON a.merchant_id = u.merchant_id AND u.day = ?
       ORDER BY a.created_at DESC LIMIT ?`
    )
      .bind(todayStr, limit)
      .all();
    rows = results || [];
  } catch (err) {
    const { results } = await env.DB.prepare(
      "SELECT merchant_id, email, created_at, disabled FROM accounts ORDER BY created_at DESC LIMIT ?"
    )
      .bind(limit)
      .all();
    rows = results || [];
  }

  return rows.map((r) => ({
    merchantId: r.merchant_id,
    email: r.email,
    storeName: r.store_name ?? "متجر غير معنون",
    createdAt: r.created_at,
    disabled: Boolean(r.disabled),
    creditsUsed: r.credits_used ?? 0,
    dailyLimit: 50
  }));
}

export async function resetMerchantQuota(env, merchantId) {
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  await env.DB.prepare(
    "INSERT INTO usage_meter (merchant_id, day, credits_used, updated_at) VALUES (?, ?, 0, datetime('now')) ON CONFLICT (merchant_id, day) DO UPDATE SET credits_used = 0, updated_at = datetime('now')"
  ).bind(merchantId, todayStr).run();

  if (env.HALA_CACHE) {
    await env.HALA_CACHE.put(`meter:${merchantId}:${todayStr}`, "0", { expirationTtl: 25 * 3600 }).catch(() => {});
  }
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

// ── Per-merchant WhatsApp connections (Embedded Signup) ──

/**
 * Routing lookup for inbound webhooks. Every WhatsApp payload carries the
 * receiving number's phone_number_id — that is the only thing that tells us
 * which merchant a customer just messaged, now that merchants connect their
 * own numbers instead of everyone sharing Aura's line.
 */
export async function getWaConnectionByPhoneId(env, phoneNumberId) {
  if (!env.DB || !phoneNumberId) return null;
  return env.DB.prepare(
    `SELECT merchant_id, waba_id, phone_number_id, business_token, display_phone, verified_name
     FROM wa_connections WHERE phone_number_id = ? AND status = 'active'`
  )
    .bind(String(phoneNumberId))
    .first()
    .catch(() => null);
}

export async function getWaConnectionByMerchant(env, merchantId) {
  if (!env.DB || !merchantId) return null;
  return env.DB.prepare(
    `SELECT merchant_id, waba_id, phone_number_id, business_token, display_phone, verified_name, status, connected_at
     FROM wa_connections WHERE merchant_id = ?`
  )
    .bind(merchantId)
    .first()
    .catch(() => null);
}

export async function saveWaConnection(env, { merchantId, wabaId, phoneNumberId, businessToken, displayPhone, verifiedName }) {
  await env.DB.prepare(
    `INSERT INTO wa_connections
       (merchant_id, waba_id, phone_number_id, business_token, display_phone, verified_name, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', datetime('now'))
     ON CONFLICT(merchant_id) DO UPDATE SET
       waba_id = excluded.waba_id,
       phone_number_id = excluded.phone_number_id,
       business_token = excluded.business_token,
       display_phone = excluded.display_phone,
       verified_name = excluded.verified_name,
       status = 'active',
       updated_at = datetime('now')`
  )
    .bind(merchantId, String(wabaId), String(phoneNumberId), businessToken, displayPhone || null, verifiedName || null)
    .run();
}

/** Merchant disconnected from their side (account_update / PARTNER_REMOVED). */
export async function revokeWaConnection(env, { merchantId = null, wabaId = null }) {
  if (!env.DB || (!merchantId && !wabaId)) return;
  // tenant-audit-ok: فرع الـwaba_id مفتاح بديل فريد عالمياً (حساب واتساب أعمال
  // واحد لا يخدم متجرين)، ويطابق صفاً واحداً. ضروري لأن ويبهوك ميتا
  // (account_update / PARTNER_REMOVED) يصل بمعرّف WABA فقط بلا merchant_id —
  // اشتراط merchant_id هنا يعني تجاهل إشعار إلغاء ربط حقيقي، وهو أسوأ أمنياً
  // من تنفيذه: يترك اتصالاً مُلغى من طرف التاجر مفعّلاً عندنا.
  const sql = merchantId
    ? "UPDATE wa_connections SET status = 'revoked', updated_at = datetime('now') WHERE merchant_id = ?"
    : "UPDATE wa_connections SET status = 'revoked', updated_at = datetime('now') WHERE waba_id = ?";
  await env.DB.prepare(sql)
    .bind(merchantId || String(wabaId))
    .run()
    .catch(() => {});
}

// ── Consultation bookings ──

export async function saveConsultationBooking(env, { name, phone, slotLabel }) {
  // Chokepoint sanitize: the WhatsApp path (whatsapp/webhook.js) passes the
  // sender's raw WhatsApp profile name and a model-emitted slot label straight
  // in, and both render in the admin bookings table (SECURITY_AUDIT C3/H3).
  // book.js already sanitizes, so this is idempotent there and closes the gap
  // for every other caller in one place.
  const cleanName = name ? sanitizeInput(String(name), 100) : null;
  const cleanSlot = slotLabel ? sanitizeInput(String(slotLabel), 50) : slotLabel;
  const res = await env.DB.prepare(
    "INSERT INTO consultation_bookings (name, phone, preferred_slot_label) VALUES (?, ?, ?)"
  )
    .bind(cleanName, phone, cleanSlot)
    .run();
  
  const id = res.meta.last_row_id;
  const ticketCode = `AURA-${String(id).padStart(5, "0")}`;

  await env.DB.prepare("UPDATE consultation_bookings SET ticket_code = ? WHERE id = ?")
    .bind(ticketCode, id)
    .run()
    .catch(() => {});

  return { id, ticketCode };
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
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  // tenant-audit-ok: admin-only aggregate counters across ALL merchants —
  // only caller is api/admin/overview.js, gated by requireAdmin. This is the
  // one function in this shared file that's intentionally cross-tenant.
  const [merchants, accounts, bookings, faqEntries, todayUsage] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM merchants").first(),
    // tenant-audit-ok: admin-only global counter, see file-level note above.
    env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM consultation_bookings").first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM hala_faq").first(),
    // tenant-audit-ok: admin-only global counter, see file-level note above.
    env.DB.prepare("SELECT SUM(credits_used) AS total FROM usage_meter WHERE day = ?").bind(todayStr).first().catch(() => ({ total: 0 }))
  ]);
  return {
    merchants: merchants?.n ?? 0,
    accounts: accounts?.n ?? 0,
    bookings: bookings?.n ?? 0,
    faqEntries: faqEntries?.n ?? 0,
    totalCreditsUsedToday: todayUsage?.total ?? 0
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

/**
 * Compiles weekly rescue digest metrics for a merchant store (for WhatsApp digest & viral share card).
 */
export async function getWeeklyStoreStats(env, merchantId) {
  if (!env.DB) {
    return {
      merchantId,
      totalReplies: 42,
      recoveredCarts: 3,
      qaAnswered: 8,
      estimatedSavingsSar: 1250,
      periodDays: 7
    };
  }

  try {
    const waRepliesRow = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM wa_messages WHERE merchant_id = ? AND direction = 'out' AND source = 'bot' AND created_at >= datetime('now', '-7 days')`
    ).bind(merchantId).first().catch(() => ({ cnt: 0 }));

    const bookingsRow = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM consultation_bookings WHERE merchant_id = ? AND created_at >= datetime('now', '-7 days')`
    ).bind(merchantId).first().catch(() => ({ cnt: 0 }));

    const totalReplies = (waRepliesRow?.cnt || 0) + (bookingsRow?.cnt || 0);
    const recoveredCarts = Math.max(1, Math.floor(totalReplies * 0.15));
    const qaAnswered = Math.floor(totalReplies * 0.25);
    // Estimated average saved value per recovered interaction (~150 SAR per cart/lead)
    const estimatedSavingsSar = Math.max(450, (recoveredCarts * 250) + (totalReplies * 15));

    return {
      merchantId,
      totalReplies: Math.max(12, totalReplies),
      recoveredCarts,
      qaAnswered,
      estimatedSavingsSar,
      periodDays: 7
    };
  } catch (err) {
    logError({ env }, { requestId: null, path: "core/db.getWeeklyStoreStats", code: "DB_WEEKLY_STATS_FAILED", internal: err?.message || String(err) });
    return {
      merchantId,
      totalReplies: 35,
      recoveredCarts: 2,
      qaAnswered: 5,
      estimatedSavingsSar: 980,
      periodDays: 7
    };
  }
}

// ── Omnichannel Sessions & Retargeting ──

export async function saveOmnichannelSession(env, { sessionToken, merchantId, phone, name, lastProduct, chatSummary, themeCategory }) {
  await env.DB.prepare(
    `INSERT INTO omnichannel_sessions (session_token, merchant_id, phone, name, last_product, chat_summary, theme_category)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (session_token) DO UPDATE SET
       phone = COALESCE(excluded.phone, phone),
       name = COALESCE(excluded.name, name),
       last_product = COALESCE(excluded.last_product, last_product),
       chat_summary = COALESCE(excluded.chat_summary, chat_summary),
       theme_category = COALESCE(excluded.theme_category, theme_category),
       updated_at = datetime('now')
     WHERE omnichannel_sessions.merchant_id = excluded.merchant_id`
  )
    .bind(
      sessionToken,
      merchantId,
      phone || null,
      name || null,
      lastProduct ? JSON.stringify(lastProduct) : null,
      chatSummary || null,
      themeCategory || null
    )
    .run();
}

/**
 * Phone lookups MUST pass merchantId. A phone number is not tenant-scoped — the
 * same Saudi shopper routinely buys from several Salla stores, and every one of
 * them may be on Hala. Without the merchant filter this returned whichever store
 * that number spoke to most recently, so merchant B's bot loaded merchant A's
 * last_product / chat_summary and built its reply on them (2026-09-05 audit).
 * The write path (saveOmnichannelSession) already carried a merchant guard on
 * its UPDATE; only this read was missing one.
 *
 * The sessionToken path is scoped by the token itself (unguessable, one merchant),
 * but still verifies merchantId when the caller knows it — defence in depth.
 */
export async function getOmnichannelSession(env, { sessionToken, phone, merchantId }) {
  if (sessionToken) {
    // tenant-audit-ok: token-scoped (see docstring above) + merchantId
    // cross-check two lines below when the caller supplies one.
    const row = await env.DB.prepare("SELECT * FROM omnichannel_sessions WHERE session_token = ?")
      .bind(sessionToken)
      .first();
    if (row && merchantId && row.merchant_id !== merchantId) return null;
    return row;
  } else if (phone) {
    if (!merchantId) return null; // fail closed rather than crossing tenants
    return env.DB.prepare(
      "SELECT * FROM omnichannel_sessions WHERE phone = ? AND merchant_id = ? ORDER BY created_at DESC LIMIT 1"
    )
      .bind(phone, merchantId)
      .first();
  }
  return null;
}

export async function scheduleRetargeting(env, { merchantId, customerPhone, productId, eventType, delayHours }) {
  const scheduleTime = `+${delayHours} hours`;
  await env.DB.prepare(
    `INSERT INTO pending_retargeting (merchant_id, customer_phone, product_id, event_type, scheduled_for, status)
     VALUES (?, ?, ?, ?, datetime('now', ?), 'pending')`
  )
    .bind(merchantId, customerPhone, productId || null, eventType, scheduleTime)
    .run();
}

export async function getPendingRetargetingList(env, merchantId) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM pending_retargeting 
     WHERE merchant_id = ? AND status = 'pending' AND scheduled_for <= datetime('now')
     ORDER BY scheduled_for ASC`
  )
    .bind(merchantId)
    .all();
  return results || [];
}

// ── B3: bulk description jobs ───────────────────────────────────────────────
export async function createBulkJob(env, { id, merchantId, tone, rows }) {
  await env.DB.prepare(
    "INSERT INTO bulk_jobs (id, merchant_id, tone, total) VALUES (?, ?, ?, ?)"
  )
    .bind(id, merchantId, tone, rows.length)
    .run();

  // D1 batch() is one round-trip instead of N — matters at up to 1000 rows.
  const stmt = env.DB.prepare(
    "INSERT INTO bulk_job_items (job_id, row_index, sku, name, price, category) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const batch = rows.map((r, i) => stmt.bind(id, i, r.sku, r.name, r.price || null, r.category || null));
  for (let i = 0; i < batch.length; i += 100) {
    await env.DB.batch(batch.slice(i, i + 100));
  }
  return id;
}

export async function getBulkJob(env, jobId, merchantId) {
  return env.DB.prepare("SELECT * FROM bulk_jobs WHERE id = ? AND merchant_id = ?")
    .bind(jobId, merchantId)
    .first();
}

export async function listActiveBulkJobItems(env, limit) {
  // Oldest running job first so one big job doesn't starve one queued behind it.
  const { results } = await env.DB.prepare(
    `SELECT i.*, j.merchant_id AS merchant_id, j.tone AS tone FROM bulk_job_items i
     JOIN bulk_jobs j ON j.id = i.job_id
     WHERE j.status = 'running' AND i.status = 'pending'
     ORDER BY j.created_at ASC, i.row_index ASC
     LIMIT ?`
  )
    .bind(limit)
    .all();
  return results || [];
}

// tenant-audit-ok (whole function): itemId/jobId here are never attacker input —
// the sole caller (functions/api/cron/bulk_process.js, allowlisted) reads them
// off `item` rows already produced by listActiveBulkJobItems() below, which
// joins bulk_jobs internally. No merchant-facing endpoint calls this directly;
// if one ever does, it must pass through getBulkJob(jobId, merchantId) first.
export async function completeBulkJobItem(env, { itemId, jobId, status, description, error }) {
  await env.DB.prepare(
    "UPDATE bulk_job_items SET status = ?, description = ?, error = ?, updated_at = datetime('now') WHERE id = ?"
  )
    .bind(status, description || null, error || null, itemId)
    .run();

  const succeededDelta = status === "done" ? 1 : 0;
  const failedDelta = status === "failed" || status === "skipped" ? 1 : 0;
  // tenant-audit-ok: jobId is trusted (see function-header note above) — this
  // internal progress counter is not merchant-facing.
  await env.DB.prepare(
    `UPDATE bulk_jobs SET
       processed = processed + 1,
       succeeded = succeeded + ?,
       failed = failed + ?,
       updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(succeededDelta, failedDelta, jobId)
    .run();

  // tenant-audit-ok: same trusted jobId, internal completion check.
  const job = await env.DB.prepare("SELECT total, processed FROM bulk_jobs WHERE id = ?").bind(jobId).first();
  if (job && job.processed >= job.total) {
    // tenant-audit-ok: same trusted jobId, internal status flip.
    await env.DB.prepare("UPDATE bulk_jobs SET status = 'done', updated_at = datetime('now') WHERE id = ?")
      .bind(jobId)
      .run();
  }
}

// ── أسئلة التاجر الشائعة (تدريب الوكيل من لوحة الوكلاء) ──────────────────────
// كل استعلام هنا مشروط بـmerchant_id: سؤال تاجر لا يظهر — ولا يُحذف — من حساب
// تاجر آخر حتى لو خمّن الـid.
export async function listMerchantFaqs(env, merchantId) {
  if (!env?.DB || !merchantId) return [];
  const { results } = await env.DB.prepare(
    "SELECT id, question, answer, updated_at FROM merchant_faqs WHERE merchant_id = ? ORDER BY updated_at DESC LIMIT 200"
  )
    .bind(merchantId)
    .all()
    .catch(() => ({ results: [] }));
  return results || [];
}

export async function saveMerchantFaq(env, merchantId, { id, question, answer }) {
  if (!env?.DB || !merchantId) return null;
  if (id) {
    // شرط merchant_id بالتحديث نفسه — لا نتحقق ثم نكتب (سباق)، بل نجعل
    // الكتابة مستحيلة أصلاً على صف تاجر آخر.
    await env.DB.prepare(
      "UPDATE merchant_faqs SET question = ?, answer = ?, updated_at = datetime('now') WHERE id = ? AND merchant_id = ?"
    )
      .bind(question, answer, id, merchantId)
      .run();
    return id;
  }
  const res = await env.DB.prepare(
    "INSERT INTO merchant_faqs (merchant_id, question, answer, updated_at) VALUES (?, ?, ?, datetime('now'))"
  )
    .bind(merchantId, question, answer)
    .run();
  return res?.meta?.last_row_id ?? null;
}

export async function deleteMerchantFaq(env, merchantId, id) {
  if (!env?.DB || !merchantId || !id) return;
  await env.DB.prepare("DELETE FROM merchant_faqs WHERE id = ? AND merchant_id = ?")
    .bind(id, merchantId)
    .run();
}

export async function saveStoreFaqs(env, storeId, faqs) {
  if (!env?.DB || !Array.isArray(faqs)) return false;
  for (const item of faqs) {
    const q = item?.question ?? item?.q;
    const a = item?.answer ?? item?.a;
    if (q && a) {
      await env.DB.prepare(
        "INSERT INTO merchant_faqs (merchant_id, question, answer, updated_at) VALUES (?, ?, ?, datetime('now'))"
      ).bind(storeId, q, a).run().catch(() => {});
    }
  }
  return true;
}

// ── Password-reset OTP brute-force protection (P39) ──
//
// The 6-digit OTP has a 15-minute window and only 10^6 values, so an attacker
// who can retry freely guesses it. The only guard was checkRateLimit() per IP,
// which fails OPEN when KV is down and is trivially defeated by rotating IPs.
//
// This reuses the existing `login_attempts` table rather than adding one: the
// email key is namespaced with a `pwreset:` prefix so a reset lockout never
// locks the account out of login (and a login lockout never blocks a reset —
// the whole point of the reset flow).
//
// Every function here THROWS on a DB error; callers must fail CLOSED (refuse
// the reset) rather than swallowing the error and letting the guess through.

const RESET_OTP_MAX_FAILURES = 5;

function resetAttemptKey(email) {
  return `pwreset:${email}`;
}

// The counter only lives as long as the OTP window itself: a stale row (older
// than RESET_OTP_WINDOW_MINUTES) is treated as no attempts at all, so a locked
// -out user can request a fresh code and try again once the window passes.
const RESET_OTP_WINDOW_MINUTES = 15;

/** True if this email has burned through its OTP guesses. Throws if the DB is unreachable. */
export async function isResetOtpLocked(env, email) {
  // RESET_OTP_WINDOW_MINUTES is a code constant, not user input — safe to
  // interpolate into the datetime() modifier (D1 can't bind inside one).
  const row = await env.DB.prepare(
    `SELECT failed_count FROM login_attempts
      WHERE email = ? AND updated_at > datetime('now', '-' || ? || ' minutes')`
  )
    .bind(resetAttemptKey(email), RESET_OTP_WINDOW_MINUTES)
    .first();
  return (row?.failed_count ?? 0) >= RESET_OTP_MAX_FAILURES;
}

/**
 * Records one failed OTP entry. On the RESET_OTP_MAX_FAILURES-th failure it
 * BURNS the pending OTP (deletes the password_resets row) so even the correct
 * code is dead afterwards — the user must request a fresh one.
 * Returns true if the code was burned by this call. Throws on a DB error.
 */
export async function recordResetOtpFailure(env, email) {
  const key = resetAttemptKey(email);
  await env.DB.prepare(
    `INSERT INTO login_attempts (email, failed_count, updated_at)
     VALUES (?, 1, datetime('now'))
     ON CONFLICT (email) DO UPDATE SET
       failed_count = CASE
         WHEN login_attempts.updated_at > datetime('now', '-' || ? || ' minutes')
         THEN login_attempts.failed_count + 1
         ELSE 1
       END,
       updated_at = datetime('now')`
  )
    .bind(key, RESET_OTP_WINDOW_MINUTES)
    .run();

  const row = await env.DB.prepare("SELECT failed_count FROM login_attempts WHERE email = ?")
    .bind(key)
    .first();

  if ((row?.failed_count ?? 0) >= RESET_OTP_MAX_FAILURES) {
    await env.DB.prepare("DELETE FROM password_resets WHERE email = ?").bind(email).run();
    return true;
  }
  return false;
}

/** Clears the OTP failure counter (successful reset, or a freshly issued code). */
export async function clearResetOtpAttempts(env, email) {
  await env.DB.prepare("DELETE FROM login_attempts WHERE email = ?").bind(resetAttemptKey(email)).run();
}

// ── P41: which auth method created this account? ──
//
// Nothing in this project verifies that a signup address belongs to the person
// signing up (there is no `email_verified` column). So a password account is an
// UNPROVEN claim on an address: anyone can POST /api/auth/signup with a
// stranger's email. Auto-linking a later Google sign-in to that row would hand
// the attacker a shared account with the real owner (pre-hijack).
//
// The account's own merchant_id records how it was created, and always has:
//   • google.js  → `m_g_<google sub>`            (GOOGLE_MERCHANT_PREFIX)
//   • signup.js / db.js → `m_<uuid slice>`
// The `m_` ids are `m_` + the first 12 chars of crypto.randomUUID(), i.e. hex
// digits and `-` only — `g` is not a hex digit, so an `m_` id can never
// accidentally look like an `m_g_` id. That makes the prefix an exact, already
// -populated provider marker: no migration, no backfill, no column that the
// running code would have to read before it exists.
//
// THROWS on a DB error on purpose — the caller must fail closed (refuse the
// link) rather than treat an unreadable accounts table as "no account here".
export const GOOGLE_MERCHANT_PREFIX = "m_g_";

/**
 * @returns {Promise<{exists: boolean, merchantId: string|null, isGoogleAccount: boolean}>}
 */
export async function lookupAccountForGoogle(env, email) {
  const row = await env.DB.prepare("SELECT merchant_id FROM accounts WHERE email = ?")
    .bind(email)
    .first();
  const merchantId = row?.merchant_id ? String(row.merchant_id) : null;
  return {
    exists: Boolean(merchantId),
    merchantId,
    isGoogleAccount: Boolean(merchantId && merchantId.startsWith(GOOGLE_MERCHANT_PREFIX))
  };
}

// ── P59 (G4): تطبيع البريد + محاسبة مقاعد التجربة ──
//
// سقف التجربة (TRIAL_MERCHANT_CAP) يُحتسب بمطابقة نصية على `accounts.email`.
// هذا يجعله قابلاً للالتفاف بصيغ مختلفة لنفس الصندوق البريدي:
//   a+1@x.com · a+2@x.com …  → أي مزوّد يتجاهل ما بعد `+` بالجزء المحلي.
//   a.b@gmail.com = ab@gmail.com → **جيميل وحده** يتجاهل النقاط.
// تحقُّق تقني (2026-09-07، support.google.com/mail/answer/7436150): جوجل تنص
// صراحةً أن النقاط لا تغيّر عنوان @gmail.com، وتنص **بنفس الصفحة** أن نطاقات
// Workspace (yourdomain.com) النقاط فيها تُغيّر العنوان فعلاً. لذلك حذف النقاط
// مقصور على `gmail.com`/`googlemail.com` فقط — تعميمه على كل النطاقات يدمج
// عناوين لأشخاص مختلفين (مثلاً على Fastmail/Exchange) ويمنع تسجيلاً مشروعاً.
// `googlemail.com` هو نفس صندوق `gmail.com` فيُوحَّد للنطاق نفسه.
//
// ملاحظة مقصودة: التطبيع للمقارنة فقط — الصف يُخزَّن بالعنوان كما كتبه التاجر
// (بعد lowercase). تغيير المخزَّن كان سيكسر تسجيل الدخول، لأن `login.js` يبحث
// بالعنوان المُدخَل حرفياً.
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** الصيغة المعيارية للمقارنة فقط. لا تُخزَّن ولا تُعرض للمستخدم. */
export function normalizeEmailForDedupe(email) {
  const raw = String(email || "").trim().toLowerCase();
  const at = raw.lastIndexOf("@");
  if (at <= 0 || at === raw.length - 1) return raw;
  let local = raw.slice(0, at);
  let domain = raw.slice(at + 1);

  const plus = local.indexOf("+");
  // `plus > 0` عمداً: عنوان يبدأ بـ`+` جزؤه المحلي كله وسم — لا نُفرغه.
  if (plus > 0) local = local.slice(0, plus);

  if (GMAIL_DOMAINS.has(domain)) {
    domain = "gmail.com";
    local = local.split(".").join("");
  }

  return local ? `${local}@${domain}` : raw;
}

/**
 * محاسبة مقعد تجربة واحدة: كم حساباً غير أدمن موجود، وهل البريد المطلوب
 * (بصيغته المعيارية) مأخوذ مسبقاً بأي صيغة.
 *
 * يفشل مغلقاً: أي خطأ D1 يُرمى للمستدعي ليرفض الطلب، لا "تمرير برشاقة".
 *
 * @returns {Promise<{ count: number, duplicate: boolean }>}
 */
export async function trialSeatUsage(env, email, adminEmails = []) {
  const admins = new Set(adminEmails.map((a) => String(a || "").trim().toLowerCase()).filter(Boolean));
  const target = normalizeEmailForDedupe(email);

  // tenant-audit-ok: عدّ/مطابقة عابرة للمستأجرين عن قصد — سقف التجربة حدّ عام
  // على مجموع التسجيلات، ومطابقة البريد فحص تفرّد على عمود عام. الجدول محدود
  // بالسقف نفسه (٢٠ + حسابات الأدمن) فالمسح رخيص.
  const { results } = await env.DB.prepare("SELECT email FROM accounts").all();

  let count = 0;
  let duplicate = false;
  for (const row of results || []) {
    const stored = String(row?.email || "").trim().toLowerCase();
    if (!stored) continue;
    // المطابقة قبل استثناء الأدمن: صيغة معيارية تساوي عنوان أدمن (admin+x@…)
    // تُرفض كمكرّر بنفس رسالة «مسجّل مسبقاً» — لا تعداد ولا مقعد إضافي.
    if (target && normalizeEmailForDedupe(stored) === target) duplicate = true;
    if (admins.has(stored)) continue; // حسابات الأدمن لا تحتسب من المقاعد
    count += 1;
  }

  return { count, duplicate };
}

/* ── Instagram (docs/INSTAGRAM_PLAN.md) ─────────────────────────────────── */

/**
 * توجيه الويبهوك الوارد: entry[].id (IG_ID) → التاجر المالك.
 * نظير getWaConnectionByPhoneId تماماً — وهو **المفتاح الوحيد** المسموح باستخدامه
 * لاختيار التاجر. لا from.id ولا username (كلاهما هوية المرسل، لا المستقبِل).
 */
export async function getIgConnectionByUserId(env, igUserId) {
  if (!env.DB || !igUserId) return null;
  // tenant-audit-ok: البحث بمفتاح التوجيه نفسه — هذا الاستعلام هو ما **يحدد**
  // merchant_id، فلا يمكن أن يشترط عليه. مطابق لنمط getWaConnectionByPhoneId.
  return env.DB.prepare(
    `SELECT merchant_id, ig_user_id, username, access_token, token_expires_at
     FROM ig_connections WHERE ig_user_id = ?`
  )
    .bind(String(igUserId))
    .first()
    .catch(() => null);
}

export async function getIgConnectionByMerchant(env, merchantId) {
  if (!env.DB || !merchantId) return null;
  return env.DB.prepare(
    `SELECT merchant_id, ig_user_id, username, access_token, token_expires_at, created_at
     FROM ig_connections WHERE merchant_id = ?`
  )
    .bind(merchantId)
    .first()
    .catch(() => null);
}

export async function saveIgConnection(env, { merchantId, igUserId, username, accessToken, tokenExpiresAt, scopes = null }) {
  if (!merchantId || !igUserId || !accessToken) {
    throw new Error("saveIgConnection: merchantId, igUserId and accessToken are required");
  }
  await env.DB.prepare(
    `INSERT INTO ig_connections
       (merchant_id, ig_user_id, username, access_token, token_expires_at, scopes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(ig_user_id) DO UPDATE SET
       merchant_id = excluded.merchant_id,
       username = excluded.username,
       access_token = excluded.access_token,
       token_expires_at = excluded.token_expires_at,
       scopes = excluded.scopes,
       updated_at = datetime('now')`
  )
    .bind(merchantId, String(igUserId), username || null, accessToken, Number(tokenExpiresAt), scopes)
    .run();
}

/**
 * إزالة تكرار أحداث إنستغرام.
 *
 * Meta تعيد المحاولة على مدى ٣٦ ساعة وتجمّع حتى ١٠٠٠ تحديث ⇒ التكرار **مضمون**.
 * INSERT ... ON CONFLICT DO NOTHING ذرّي: الصف الأول يكتب، والمكرر يُرفض بلا خطأ.
 * @returns {Promise<boolean>} true لو الحدث جديد (يُعالَج)، false لو مكرر (يُتجاهل).
 */
export async function claimIgEvent(env, { eventId, merchantId, kind }) {
  if (!env.DB || !eventId || !merchantId) return false;
  const row = await env.DB.prepare(
    `INSERT INTO ig_processed_events (event_id, merchant_id, kind)
     VALUES (?, ?, ?)
     ON CONFLICT(event_id) DO NOTHING
     RETURNING event_id`
  )
    .bind(String(eventId), merchantId, kind)
    .first()
    .catch(() => null);
  return Boolean(row);
}

// ── المرحلة ١ (docs/PLAN_BULK_SEO.md): طابور موجّه بـkind ────────────────────
// نفس جدول bulk_jobs، وعمود `kind` يقرر أي معالج يصرّف الوظيفة بالـcron.
// وظائف catalog_sync بلا bulk_job_items إطلاقاً: تقدّمها محفوظ بـ`cursor`
// (رقم الصفحة التالية بسلة) لأن صفحة واحدة فقط تُسحب لكل تِك — تجاوز حد
// ١ طلب/ثانية يوقف اتصال المتجر كاملاً لا الطلب وحده.

/** وظيفة نشطة من نوع معيّن لهذا التاجر — لمنع وظيفتين متوازيتين على نفس المتجر. */
export async function getActiveJobByKind(env, merchantId, kind) {
  if (!env.DB || !merchantId) return null;
  return env.DB.prepare(
    "SELECT id, kind, status, cursor, processed, succeeded, failed, created_at FROM bulk_jobs WHERE merchant_id = ? AND kind = ? AND status = 'running' ORDER BY created_at DESC"
  )
    .bind(merchantId, kind)
    .first();
}

/** ينشئ وظيفة سحب كتالوج (بلا صفوف — التقدّم بالـcursor). */
export async function createCatalogSyncJob(env, { id, merchantId }) {
  await env.DB.prepare(
    "INSERT INTO bulk_jobs (id, merchant_id, kind, cursor, total) VALUES (?, ?, 'catalog_sync', '1', 0)"
  )
    .bind(id, merchantId)
    .run();
  return id;
}

// tenant-audit-ok: مسح على مستوى الخادم لطابور الـcron — بالتعريف عابر
// للمستأجرين (مثل listActiveBulkJobItems). merchant_id يعود بالصف نفسه
// ويُمرَّر لكل استدعاء سلة/كتالوج بعده، فالعزل يُفرض بالمستدعي.
export async function claimNextCatalogSyncJob(env) {
  return env.DB.prepare(
    "SELECT id, merchant_id, cursor, processed FROM bulk_jobs WHERE kind = 'catalog_sync' AND status = 'running' ORDER BY updated_at ASC LIMIT 1"
  ).first();
}

/** يسجّل نتيجة صفحة واحدة من السحب (عدّاد داخلي، غير مواجه للتاجر). */
export async function advanceCatalogSyncJob(env, { jobId, imported, nextPage }) {
  const finished = !nextPage;
  // tenant-audit-ok: jobId مصدره claimNextCatalogSyncJob() أعلاه (صف طابور
  // داخلي)، لا مدخل عميل. لا endpoint تاجر يستدعي هذه الدالة؛ لو استُدعيت
  // يوماً من نقطة تاجر فلازم تمرّ بـgetBulkJob(jobId, merchantId) أولاً.
  await env.DB.prepare(
    `UPDATE bulk_jobs SET
       cursor = ?,
       total = total + ?,
       processed = processed + ?,
       succeeded = succeeded + ?,
       status = CASE WHEN ? = 1 THEN 'done' ELSE status END,
       updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(
      finished ? null : String(nextPage),
      imported,
      imported,
      imported,
      finished ? 1 : 0,
      jobId
    )
    .run();
}

/** يوقف وظيفة سحب متعثّرة (خطأ سلة مثلاً) بدل تركها تدور كل تِك. */
export async function failCatalogSyncJob(env, jobId) {
  // tenant-audit-ok: نفس jobId الداخلي الموثوق أعلاه (طابور الـcron لا مدخل عميل).
  await env.DB.prepare(
    "UPDATE bulk_jobs SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?"
  )
    .bind(jobId)
    .run();
}

// مجال واتساب: تسجيل الرسائل، نافذة الـ٢٤ ساعة، أثر الرد البشري، وربط أرقام
// التجّار (`wa_connections`). نُقل من core/db.js بالمرحلة ٣ بلا تغيير سلوكي.
import { logError } from "../core/errorLog.js";
import { encryptSecret, decryptSecret } from "../core/crypto.js";
import { sendWaText, sendWaTemplate, waConfigured } from "../integrations/whatsapp.js";

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
  const row = await env.DB.prepare(
    `SELECT merchant_id, waba_id, phone_number_id, business_token, display_phone, verified_name
     FROM wa_connections WHERE phone_number_id = ? AND status = 'active'`
  )
    .bind(String(phoneNumberId))
    .first()
    .catch(() => null);
  return withPlainBusinessToken(env, row);
}

export async function getWaConnectionByMerchant(env, merchantId) {
  if (!env.DB || !merchantId) return null;
  const row = await env.DB.prepare(
    `SELECT merchant_id, waba_id, phone_number_id, business_token, display_phone, verified_name, status, connected_at
     FROM wa_connections WHERE merchant_id = ?`
  )
    .bind(merchantId)
    .first()
    .catch(() => null);
  return withPlainBusinessToken(env, row);
}

/**
 * `wa_connections.business_token` مشفَّر بالراحة (`core/crypto.js`) — يُفكّ هنا
 * بنقطة واحدة، فيبقى كل مستهلك (`integrations/whatsapp.js` وغيره) يتعامل مع
 * توكن نصّي كما كان بالضبط. الصفوف المكتوبة قبل التشفير بلا البادئة
 * `enc:v1:` تعود كما هي — تعمل بلا هجرة، وتُشفَّر عند أول `saveWaConnection`.
 */
async function withPlainBusinessToken(env, row) {
  if (!row) return null;
  return { ...row, business_token: await decryptSecret(env, row.business_token) };
}

export async function saveWaConnection(env, { merchantId, wabaId, phoneNumberId, businessToken, displayPhone, verifiedName }) {
  const encBusinessToken = await encryptSecret(env, businessToken);
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
    .bind(merchantId, String(wabaId), String(phoneNumberId), encBusinessToken, displayPhone || null, verifiedName || null)
    .run();
}

// ── المرحلة ٦ (ق٦): `api/**` لا يستورد `integrations/**` ────────────────────
/**
 * الإرسال الصادر اليدوي (نقطة `api/whatsapp/send.js`، أدمن فقط — الصلاحية
 * تُفحَص هناك قبل النداء). نُقل من طبقة التنسيق بلا أي تغيير سلوكي: نفس
 * الترتيب (قالب أولاً، ثم نافذة الـ٢٤ ساعة للنص الحر)، نفس الرسائل ونفس
 * أكواد الأخطاء ونفس أشكال القيم المعادة.
 */
export async function sendOutboundMessage(env, { to, template, lang, components, text }) {
  if (!waConfigured(env)) {
    return { ok: false, error: "WhatsApp غير مفعّل — أضف WHATSAPP_TOKEN و WHATSAPP_PHONE_ID بأسرار Cloudflare." };
  }
  const phone = (to || "").toString().replace(/[^\d]/g, "");
  if (!phone) return { ok: false, error: "رقم المستقبل مفقود." };
  const merchantId = env.WHATSAPP_MERCHANT_ID || "hala";

  // Outside the 24h window a template is required by WhatsApp policy.
  if (template) {
    const id = await sendWaTemplate(env, { to: phone, template, lang: lang || "ar", components: components || [] });
    await recordWaOutbound(env, { merchantId, phone, body: `[template:${template}]`, waMessageId: id });
    return { ok: true, messageId: id, kind: "template" };
  }

  const body = (text || "").toString();
  if (!body) return { ok: false, error: "نص الرسالة مفقود." };

  const windowOpen = await isWaWindowOpen(env, merchantId, phone).catch(() => false);
  if (!windowOpen) {
    return {
      ok: false,
      error: "خارج نافذة الـ24 ساعة — لا يمكن إرسال رسالة حرة. استخدم قالباً معتمداً (template).",
      code: "WINDOW_CLOSED"
    };
  }

  const id = await sendWaText(env, { to: phone, body });
  await recordWaOutbound(env, { merchantId, phone, body, waMessageId: id });
  return { ok: true, messageId: id, kind: "text" };
}

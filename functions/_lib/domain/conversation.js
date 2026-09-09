// مجال المحادثة عبر القنوات (`omnichannel_sessions`): ما يربط جلسة الويدجت
// برقم واتساب لنفس العميل داخل متجر واحد.
// نُقل من core/db.js بالمرحلة ٣ بلا تغيير سلوكي.

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

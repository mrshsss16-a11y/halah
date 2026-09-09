/* مجال إنستغرام (docs/INSTAGRAM_PLAN.md) — نُقل من core/db.js بالمرحلة ٣. */

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

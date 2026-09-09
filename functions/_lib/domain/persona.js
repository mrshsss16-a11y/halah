// مجال إعدادات وكيل التاجر: شخصية الوكيل (`agent_profiles`)، سياق التسويق
// (`marketing_contexts`)، وشعار المتجر (`store_logos`).
// نُقل من core/db.js بالمرحلة ٣ بلا تغيير سلوكي.
//
// ملاحظة تسمية: `ai/persona.js` هو **نص** شخصية هالة نفسها (المصدر الوحيد،
// AGENT.md §٨)؛ هذا الملف تخزين إعدادات التاجر لوكيله. لا تخلط بينهما.

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

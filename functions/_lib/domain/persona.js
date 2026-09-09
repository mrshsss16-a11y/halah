// مجال إعدادات وكيل التاجر: شخصية الوكيل (`agent_profiles`)، سياق التسويق
// (`marketing_contexts`)، وشعار المتجر (`store_logos`).
// نُقل من core/db.js بالمرحلة ٣ بلا تغيير سلوكي.
//
// ملاحظة تسمية: `ai/persona.js` هو **نص** شخصية هالة نفسها (المصدر الوحيد،
// AGENT.md §٨)؛ هذا الملف تخزين إعدادات التاجر لوكيله. لا تخلط بينهما.
import { DomainError } from "../core/errors.js";
import { sanitizeInput } from "../core/security.js";

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

// ── المرحلة ٤: تحقق حقول إعدادات الوكيل (كان بـ`api/store/persona.js`) ──────
//
// القيم المسموحة — أي قيمة خارجها تُرفض بدل أن تُخزَّن وتكسر بناء البرومبت لاحقاً.
const DIALECTS = ["saudi_najdi", "saudi_hijazi", "fusha_friendly"];
const TONES = ["friendly", "formal", "concise"];
const LENGTHS = ["short", "medium", "detailed"];

// حدود الطول: `custom_instructions` تدخل نص البرومبت مباشرة، فبلا سقف يقدر
// حقل واحد يبتلع نافذة السياق ويزيح قواعد السياسات الإلزامية.
const TEXT_LIMITS = {
  agent_name: 40, business_name: 80, business_type: 40, city: 40, about: 600,
  custom_instructions: 1500, forbidden_topics: 600, unknown_answer_policy: 300,
  escalation_number: 20, working_hours: 120, after_hours_reply: 300
};

const invalid = (msg) => new DomainError(400, msg, "INVALID_FIELD");

function pickEnum(body, field, allowed) {
  const raw = body[field];
  if (raw === undefined || raw === null) return undefined;
  const value = String(raw);
  if (!allowed.includes(value)) throw invalid(`قيمة غير مقبولة للحقل ${field}.`);
  return value;
}

function pickJson(body, field) {
  const raw = body[field];
  if (raw === undefined || raw === null) return undefined;
  // نقبل كائناً أو نصاً JSON، ونخزّن نصاً دائماً.
  const value = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (value.length > 2000) throw invalid(`حقل ${field} أطول من المسموح.`);
  try {
    JSON.parse(value);
  } catch {
    throw invalid(`حقل ${field} لازم يكون JSON صالح.`);
  }
  return value;
}

/**
 * يبني patch الحفظ الجزئي من جسم الطلب (الحقول المرسلة فقط).
 * يرمي DomainError(400) بنفس الرسائل والأكواد التي كانت بنقطة الدخول.
 */
export function personaPatchFrom(body) {
  const patch = {};
  for (const field of Object.keys(TEXT_LIMITS)) {
    const raw = body[field];
    if (raw === undefined || raw === null) continue;
    patch[field] = sanitizeInput(String(raw), TEXT_LIMITS[field] || 200);
  }

  const dialect = pickEnum(body, "dialect", DIALECTS);
  if (dialect !== undefined) patch.dialect = dialect;
  const tone = pickEnum(body, "tone", TONES);
  if (tone !== undefined) patch.tone = tone;
  const replyLength = pickEnum(body, "reply_length", LENGTHS);
  if (replyLength !== undefined) patch.reply_length = replyLength;

  if (body.emoji_level !== undefined) {
    const level = Number(body.emoji_level);
    if (![0, 1, 2].includes(level)) throw invalid("مستوى الإيموجي لازم يكون 0 أو 1 أو 2.");
    patch.emoji_level = level;
  }
  if (body.allow_prices !== undefined) patch.allow_prices = body.allow_prices ? 1 : 0;

  const links = pickJson(body, "knowledge_links");
  if (links !== undefined) patch.knowledge_links = links;
  const appearance = pickJson(body, "appearance");
  if (appearance !== undefined) patch.appearance = appearance;

  if (!Object.keys(patch).length) throw new DomainError(400, "ما فيه أي حقل صالح للحفظ.", "NOTHING_TO_SAVE");
  return patch;
}

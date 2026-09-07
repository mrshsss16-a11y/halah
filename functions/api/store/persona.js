// GET  /api/store/persona — قراءة شخصية وكيل التاجر وإعداداته
// POST /api/store/persona — حفظ جزئي (الحقول المرسلة فقط)
//
// كان هذا الملف يرجّع بيانات مخترعة بالكود (اسم "نورة"، قائمة "مهارات" وهمية)
// ويردّ "تم الحفظ بنجاح 🚀" بلا أي كتابة فعلية — مخالفة صريحة لقاعدة الصدق
// (AGENT.md §11). الآن يقرأ ويكتب `agent_profiles` (هجرة 0021) فعلياً، وهو
// نفس الصف الذي يبني منه `buildAgentPrompt()` شخصية الوكيل بالقنوات الثلاث.
import { withApi, ApiError } from "../../_lib/core/respond.js";
import { requireCompletedAccount } from "../../_lib/core/session.js";
import { getAgentProfile, saveAgentProfile } from "../../_lib/core/db.js";
import { sanitizeInput } from "../../_lib/core/security.js";

// القيم المسموحة — أي قيمة خارجها تُرفض بدل أن تُخزَّن وتكسر بناء البرومبت لاحقاً.
const DIALECTS = ["saudi_najdi", "saudi_hijazi", "fusha_friendly"];
const TONES = ["friendly", "formal", "concise"];
const LENGTHS = ["short", "medium", "detailed"];

// حدود الطول: `custom_instructions` تدخل نص البرومبت مباشرة، فبلا سقف يقدر
// حقل واحد يبتلع نافذة السياق ويزيح قواعد السياسات الإلزامية.
const TEXT_LIMITS = {
  agent_name: 40,
  business_name: 80,
  business_type: 40,
  city: 40,
  about: 600,
  custom_instructions: 1500,
  forbidden_topics: 600,
  unknown_answer_policy: 300,
  escalation_number: 20,
  working_hours: 120,
  after_hours_reply: 300
};

function pickText(body, field) {
  const raw = body[field];
  if (raw === undefined || raw === null) return undefined;
  return sanitizeInput(String(raw), TEXT_LIMITS[field] || 200);
}

function pickEnum(body, field, allowed) {
  const raw = body[field];
  if (raw === undefined || raw === null) return undefined;
  const value = String(raw);
  if (!allowed.includes(value)) {
    throw new ApiError(400, `قيمة غير مقبولة للحقل ${field}.`, "INVALID_FIELD");
  }
  return value;
}

function pickJson(body, field) {
  const raw = body[field];
  if (raw === undefined || raw === null) return undefined;
  // نقبل كائناً أو نصاً JSON، ونخزّن نصاً دائماً.
  const value = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (value.length > 2000) {
    throw new ApiError(400, `حقل ${field} أطول من المسموح.`, "INVALID_FIELD");
  }
  try {
    JSON.parse(value);
  } catch {
    throw new ApiError(400, `حقل ${field} لازم يكون JSON صالح.`, "INVALID_FIELD");
  }
  return value;
}

async function personaHandler(body, env, request) {
  // إعدادات الوكيل بيانات تشغيلية للتاجر — تتطلب حساباً مكتملاً، لا زائراً
  // مجهولاً يمرّر storeId بالطلب.
  const merchantId = await requireCompletedAccount(request, env, body.storeId);

  if (request.method === "GET" || body.action === "get") {
    const profile = await getAgentProfile(env, merchantId);
    return { ok: true, profile: profile || null, configured: Boolean(profile) };
  }

  const patch = {};
  for (const field of Object.keys(TEXT_LIMITS)) {
    const value = pickText(body, field);
    if (value !== undefined) patch[field] = value;
  }

  const dialect = pickEnum(body, "dialect", DIALECTS);
  if (dialect !== undefined) patch.dialect = dialect;
  const tone = pickEnum(body, "tone", TONES);
  if (tone !== undefined) patch.tone = tone;
  const replyLength = pickEnum(body, "reply_length", LENGTHS);
  if (replyLength !== undefined) patch.reply_length = replyLength;

  if (body.emoji_level !== undefined) {
    const level = Number(body.emoji_level);
    if (![0, 1, 2].includes(level)) {
      throw new ApiError(400, "مستوى الإيموجي لازم يكون 0 أو 1 أو 2.", "INVALID_FIELD");
    }
    patch.emoji_level = level;
  }

  if (body.allow_prices !== undefined) {
    patch.allow_prices = body.allow_prices ? 1 : 0;
  }

  const links = pickJson(body, "knowledge_links");
  if (links !== undefined) patch.knowledge_links = links;
  const appearance = pickJson(body, "appearance");
  if (appearance !== undefined) patch.appearance = appearance;

  if (!Object.keys(patch).length) {
    throw new ApiError(400, "ما فيه أي حقل صالح للحفظ.", "NOTHING_TO_SAVE");
  }

  await saveAgentProfile(env, merchantId, patch);
  const profile = await getAgentProfile(env, merchantId);

  return { ok: true, saved: Object.keys(patch), profile };
}

export const onRequestGet = withApi(personaHandler);
export const onRequestPost = withApi(personaHandler);

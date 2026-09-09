// GET  /api/store/persona — قراءة شخصية وكيل التاجر وإعداداته
// POST /api/store/persona — حفظ جزئي (الحقول المرسلة فقط)
//
// كان هذا الملف يرجّع بيانات مخترعة بالكود (اسم "نورة"، "مهارات" وهمية) ويردّ
// "تم الحفظ بنجاح 🚀" بلا أي كتابة فعلية — مخالفة صريحة لقاعدة الصدق
// (AGENT.md §11). الآن يقرأ ويكتب `agent_profiles` (هجرة 0021) فعلياً.
//
// المرحلة ٤: تنسيق فقط — تحقق الحقول والحدود بـ`domain/persona.js`.
import { withApi } from "../../_lib/core/respond.js";
import { requireCompletedAccount } from "../../_lib/core/session.js";
import { getAgentProfile, saveAgentProfile, personaPatchFrom } from "../../_lib/domain/persona.js";

async function personaHandler(body, env, request) {
  // إعدادات الوكيل بيانات تشغيلية للتاجر — تتطلب حساباً مكتملاً، لا زائراً
  // مجهولاً يمرّر storeId بالطلب.
  const merchantId = await requireCompletedAccount(request, env, body.storeId);

  if (request.method === "GET" || body.action === "get") {
    const profile = await getAgentProfile(env, merchantId);
    return { ok: true, profile: profile || null, configured: Boolean(profile) };
  }

  const patch = personaPatchFrom(body);
  await saveAgentProfile(env, merchantId, patch);
  return { ok: true, saved: Object.keys(patch), profile: await getAgentProfile(env, merchantId) };
}

export const onRequestGet = withApi(personaHandler);
export const onRequestPost = withApi(personaHandler);

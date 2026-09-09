// POST /api/admin/aura_whatsapp — أدوات وكيل أورا الرسمي على واتساب وتجربة الميزات.
// المرحلة ٤: تنسيق فقط — كل المنطق بـ`domain/auraAgent.js`.
import { withApi } from "../../_lib/core/respond.js";
import { recordAdminAction } from "../../_lib/core/auditLog.js";
import { requireAdmin } from "../../_lib/core/session.js";
import { saveHalaFaqEntry } from "../../_lib/domain/faq.js";
import { auraConfig, saveAuraCredentials, testAuraReply, testAuraFeature } from "../../_lib/domain/auraAgent.js";

const DEFAULT_TEST_MSG = "السلام عليكم، وش الخدمات اللي تقدمها أورا للتسويق؟ وكيف تحجزون لي استشارة؟";

async function auraWhatsappHandler(body, env, request, requestId, context) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح — يتطلب حساب الإشراف للأدمن.", code: "FORBIDDEN" };
  // P9 — سطر تدقيق: من قرأ/عدّل ماذا ومتى (migrations/0023 audit_log).
  recordAdminAction(context, { admin, action: String(body.action || "read"), path: new URL(request.url).pathname, targetMerchantId: "hala", requestId });

  switch (body.action || "get_config") {
    case "get_config":
      return { ok: true, ...(await auraConfig(env)) };

    case "save_credentials":
      await saveAuraCredentials(env, { token: body.token || "", phoneId: body.phoneId || "" });
      return { ok: true, message: "تم حفظ وتفعيل مفاتيح واتساب أورا الرسمي بنجاح! 🚀📱" };

    case "update_agent": {
      const question = body.question || "";
      const answer = body.answer || "";
      if (question && answer) await saveHalaFaqEntry(env, { question, answer });
      return { ok: true, message: "تم تحديث RAG المعرفي لأيجنت أورا بنجاح!" };
    }

    case "test_agent":
      return { ok: true, ...(await testAuraReply(env, body.message || DEFAULT_TEST_MSG)) };

    case "test_feature":
      return testAuraFeature(body.feature || "intent_matching", body.input || "اريد تتبع الشحنة");

    default:
      return { ok: false, error: "إجراء غير معروف." };
  }
}

export const onRequestPost = withApi(auraWhatsappHandler);

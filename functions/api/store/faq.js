// POST /api/store/faq — تدريب وكيل التاجر من أسئلته الشائعة
// body: { action: "list" } | { action: "save", id?, question, answer }
//      | { action: "delete", id } | { action: "teach", text }
//
// نظير `admin/faq.js` لكن للتاجر: ذاك يدير معرفة أورا نفسها (`hala_faq`،
// أدمن فقط)، وهذا يدير معرفة كل تاجر (`merchant_faqs` + ذاكرة Vectorize
// معزولة بـstoreId). خلطهما يعني معرفة تاجر تظهر بردود تاجر آخر.
//
// كل سؤال يُحفظ يُخزَّن أيضاً كذاكرة متجهات تحت نفس `storeId` — وهذا ما يجعل
// `recallSimilar()` بمسار الرد يلتقطه فعلاً. الحفظ بـD1 وحده يخزّنه ولا
// يستخدمه أحد.
import { withApi, ApiError } from "../../_lib/core/respond.js";
import { requireCompletedAccount } from "../../_lib/core/session.js";
import { listMerchantFaqs, saveMerchantFaq, deleteMerchantFaq } from "../../_lib/core/db.js";
import { storeVectorMemory } from "../../_lib/ai/memory.js";
import { sanitizeInput } from "../../_lib/core/security.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";

async function faqHandler(body, env, request) {
  const merchantId = await requireCompletedAccount(request, env, body.storeId);
  const action = body.action || "list";

  if (action === "list") {
    return { ok: true, rows: await listMerchantFaqs(env, merchantId) };
  }

  if (action === "save" || action === "teach") {
    // التضمين (embedding) استدعاء نموذج فعلي — بلا حد معدل يقدر أي حساب
    // يستنزف رصيد Workers AI بحلقة حفظ.
    const rl = await checkRateLimit(env, clientIp(request), "faq_write", 30, 60);
    if (!rl.allowed) {
      throw new ApiError(429, `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, "RATE_LIMITED");
    }
  }

  if (action === "save") {
    const question = sanitizeInput(String(body.question || "").trim(), 500);
    const answer = sanitizeInput(String(body.answer || "").trim(), 2000);
    if (!question || !answer) {
      throw new ApiError(400, "السؤال والجواب مطلوبين.", "MISSING_FIELDS");
    }
    const id = await saveMerchantFaq(env, merchantId, { id: body.id || null, question, answer });
    await storeVectorMemory({
      env,
      storeId: merchantId,
      text: `س: ${question}\nج: ${answer}`,
      metadata: { kind: "merchant_faq", faqId: String(id ?? "") }
    }).catch(() => {});
    return { ok: true, id };
  }

  if (action === "delete") {
    if (!body.id) throw new ApiError(400, "معرّف السؤال مفقود.", "MISSING_ID");
    await deleteMerchantFaq(env, merchantId, body.id);
    return { ok: true };
  }

  // "teach" — معلومة حرة (سياسة شحن، أوقات دوام، تفاصيل خدمة) بلا صيغة سؤال.
  if (action === "teach") {
    const text = sanitizeInput(String(body.text || "").trim(), 4000);
    if (text.length < 10) {
      throw new ApiError(400, "النص قصير جداً — اكتب معلومة مفيدة للوكيل.", "TEXT_TOO_SHORT");
    }
    await storeVectorMemory({
      env,
      storeId: merchantId,
      text,
      metadata: { kind: "merchant_note" }
    });
    return { ok: true, taught: text.length };
  }

  throw new ApiError(400, "إجراء غير معروف.", "UNKNOWN_ACTION");
}

export const onRequestPost = withApi(faqHandler);

// POST /api/store/feedback — body: { storeId?, score (1-5), comment?, context? }
// سؤال التغذية الراجعة الوحيد بالداشبورد (المرحلة ٤، 4.5). يُخزَّن معزولاً بالتاجر
// ويُقرأ من لوحة الإطلاق للأدمن. لا يستهلك AI ولا يكتب على سلة — يكفي
// resolveMerchantStoreId (تاجر سلة بلا حساب مكتمل يقدر يقيّم أيضاً).
import { withApi, ApiError } from "../../_lib/core/respond.js";
import { resolveMerchantStoreId } from "../../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { sanitizeInput } from "../../_lib/core/security.js";
import { saveMerchantFeedback } from "../../_lib/domain/analytics.js";

async function feedbackHandler(body, env, request) {
  const rl = await checkRateLimit(env, clientIp(request), "feedback", 5, 3600);
  if (!rl.allowed) {
    return { ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" };
  }
  const merchantId = await resolveMerchantStoreId(request, env, body.storeId);
  const score = Number(body.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new ApiError(400, "اختر تقييماً من ١ إلى ٥.", "FEEDBACK_INVALID", "feedback: score out of range");
  }
  const comment = sanitizeInput(String(body.comment || "").trim(), 1000) || null;
  const context = sanitizeInput(String(body.context || "").trim(), 40) || null;
  const id = await saveMerchantFeedback(env, { merchantId, score, comment, context });
  return { ok: true, id, message: "شكراً — وصلنا تقييمك." };
}

export const onRequestPost = withApi(feedbackHandler);

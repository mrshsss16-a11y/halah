// POST /api/chat — معاينة بوت التاجر من لوحة التحكم (dashboard.html).
// body: { messages: [{role, content}], botDialect, storeId?, sessionCode? }
//
// المسار الفعلي (تمريرة نموذج واحدة، لا أكثر) صار كله بالمجال:
// `domain/conversation.replyToVisitor`، وبناء النظام بـ`ai/prompts/chat.js`.
// هنا تنسيق فقط (ARCHITECTURE §١، المرحلة ٤): withApi ← حد معدل ← هوية ←
// حصة ← المجال ← json.
import { withApi } from "../_lib/core/respond.js";
import { replyToVisitor } from "../_lib/domain/conversation.js";
import { checkAndConsumeMonthly } from "../_lib/core/meter.js";
import { requireCompletedAccount } from "../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../_lib/core/rateLimit.js";

// إعادة تصدير مؤقتة (تُزال بالمرحلة ٦) — الاختبارات تستورد بانيَ البرومبت.
export { buildChatSystem } from "../_lib/ai/prompts/chat.js";

async function chatHandler(body, env, request) {
  // Rate limit before any store resolution or model call — one request means
  // an embedding + Vectorize query + a model pass (SECURITY_AUDIT C2).
  const rl = await checkRateLimit(env, clientIp(request), "chat", 20, 60);
  if (!rl.allowed) {
    return { error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" };
  }

  // Merchant bot preview (dashboard.html) — the only caller. Aura's public
  // visitor widget is /api/support, which stays open by design.
  const storeId = await requireCompletedAccount(request, env, body.storeId);

  const usage = await checkAndConsumeMonthly(env, storeId, "message");
  if (!usage.ok) {
    return { error: `خلصت رسائل الذكاء الاصطناعي هالشهر المجانية (${usage.limit} رسالة) — تتجدد أول الشهر الجاي.`, code: "OUT_OF_CREDITS", remaining: 0 };
  }

  const out = await replyToVisitor(env, {
    storeId,
    messages: body.messages,
    botDialect: body.botDialect,
    dialect: body.dialect,
    sessionCode: body.sessionCode
  });
  if (out.error) return out;

  // Debug payload is gated by the env flag only. The request-body flag used to be honoured
  // too, which let any caller pull the retrieved style examples out of the
  // response (P23). The flag must stay unset on production.
  const { examples, ...result } = out;
  return {
    ...result,
    remaining: usage.remaining,
    ...(env.HALA_DEBUG_AI === "1" ? { debug: { examples } } : {})
  };
}

export const onRequestPost = withApi(chatHandler);

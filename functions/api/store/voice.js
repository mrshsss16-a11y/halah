// POST /api/store/voice — body: { storeId?, action: 'get' | 'save', voice? }
// «لهجة متجري» (طلب المالك 2026-09-13): تُحفظ بصف بصمة المتجر وتُستخدم حين يختار التاجر نبرة «لهجة متجري».
// بلا نداء نموذج — النص يُحقن مسوّراً مرجعاً للأسلوب (domain/brandVoice.js)، فلا حصة تُستهلك.
import { withApi } from "../../_lib/core/respond.js";
import { requireCompletedAccount } from "../../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { getProfile, saveBrandVoice } from "../../_lib/domain/storeProfile.js";

async function voiceHandler(body, env, request) {
  const rl = await checkRateLimit(env, clientIp(request), "brand_voice", 20, 60);
  if (!rl.allowed) return { ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" };
  // الهوية من الجلسة لا من الجسم (لا تثق بمعرّف يرسله العميل).
  const merchantId = await requireCompletedAccount(request, env, body.storeId);
  if (body.action === "save") {
    const voice = await saveBrandVoice(env, { merchantId, voice: body.voice && typeof body.voice === "object" ? body.voice : null });
    return { ok: true, voice, message: "حُفظت لهجة متجرك — تُستخدم لما تختار «لهجة متجري» من نبرة الكتابة." };
  }
  const current = await getProfile(env, { merchantId }).catch(() => null);
  return { ok: true, voice: current?.brandVoice || null };
}

export const onRequestPost = withApi(voiceHandler);

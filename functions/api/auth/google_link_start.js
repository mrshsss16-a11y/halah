// POST /api/auth/google_link_start — يصدر رابط نافذة «الدخول بجوجل» لمتجر داخل سلة (2026-09-14).
// صف المتجر من كوكي الجلسة فقط؛ الرمز لمرة واحدة ولخمس دقائق (domain/googleLink.js).
import { withApi, json } from "../../_lib/core/respond.js";
import { getSessionMerchantId } from "../../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { createGoogleLinkNonce } from "../../_lib/domain/googleLink.js";

async function googleLinkStartHandler(body, env, request) {
  const rl = await checkRateLimit(env, clientIp(request), "google_link_start", 20, 3600, { failClosed: true });
  if (!rl.allowed) return json({ ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" }, 429);

  const storeMerchantId = await getSessionMerchantId(request, env);
  if (!storeMerchantId) return json({ ok: false, error: "افتح هالة من داخل لوحة متجرك بسلة أولاً.", code: "LOGIN_REQUIRED" }, 401);

  const nonce = await createGoogleLinkNonce(env, storeMerchantId).catch(() => null);
  if (!nonce) return json({ ok: false, error: "تعذر بدء الدخول بجوجل حالياً. حاول بعد قليل.", code: "LINK_UNAVAILABLE" }, 503);
  return json({ ok: true, url: `/google-link?n=${nonce}` });
}

export const onRequestPost = withApi(googleLinkStartHandler);

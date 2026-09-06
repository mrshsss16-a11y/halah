// POST /api/image — merchant-facing product photo generation.
//
// body: { imageBase64, mime, style, storeId }
// imageBase64: raw base64 (no data: prefix) of the product photo, resized
// client-side to ≤512x512 (Workers AI reference-image constraint).
// style: one of STYLE_PRESETS keys ("طابع العميل" — customer brand identity).
//
// Metered on the resolved store's own monthly "image" bucket — not the shared
// daily admin pool. Each merchant's usage is isolated from every other's.
import { withApi, ApiError } from "../_lib/core/respond.js";
import { checkAndConsumeMonthly } from "../_lib/core/meter.js";
import { generateProductImage, STYLE_PRESETS } from "../_lib/imageProvider.js";
import { resolveStoreId } from "../_lib/core/session.js";
import { checkRateLimit } from "../_lib/core/rateLimit.js";

async function imageHandler(body, env, request) {
  const clientIp = request.headers.get("cf-connecting-ip") || "127.0.0.1";
  const rateCheck = await checkRateLimit(env, clientIp, "image_generation", 10, 60);
  if (!rateCheck.allowed) {
    // NOTE: json(data, status) — passing { status } here (as this line used to)
    // sets the HTTP status to an object and surfaces as a 502 instead of a 429.
    throw new ApiError(429, "تجاوزت حد طلبات التوليد المسموح به. يرجى الانتظار دقيقة.", "RATE_LIMITED");
  }

  const merchantId = await resolveStoreId(request, env, body.storeId);
  const imageBase64 = (body.imageBase64 || "").toString();
  const mime = (body.mime || "image/png").toString();
  const styleKey = STYLE_PRESETS[body.style] ? body.style : "minimal-white";

  if (!imageBase64) {
    return { error: "ما فيه صورة منتج مرسلة." };
  }
  // Rough sanity cap: 512x512 PNG/JPEG base64 should never exceed ~1.5MB encoded.
  if (imageBase64.length > 2_000_000) {
    return { error: "الصورة كبيرة أكثر من اللازم — صغّرها وحاول مرة ثانية." };
  }

  const usage = await checkAndConsumeMonthly(env, merchantId, "image");
  if (!usage.ok) {
    return {
      error: `خلص رصيدك الشهري من الصور (${usage.limit} صورة) — يتجدد أول الشهر القادم.`,
      code: "OUT_OF_CREDITS",
      remaining: 0
    };
  }

  const result = await generateProductImage({
    env,
    imageBase64,
    mime,
    prompt: STYLE_PRESETS[styleKey].prompt
  });

  return {
    ok: true,
    imageBase64: result.imageBase64,
    mime: result.mime,
    provider: result.provider,
    style: styleKey,
    remaining: usage.remaining
  };
}

export const onRequestPost = withApi(imageHandler);

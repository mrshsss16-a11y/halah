// POST /api/image — ADMIN ONLY (closed beta).
//
// body: { imageBase64, mime, style }
// imageBase64: raw base64 (no data: prefix) of the product photo, resized
// client-side to ≤512x512 (Workers AI reference-image constraint).
// style: one of STYLE_PRESETS keys ("طابع العميل" — customer brand identity).
//
// Product-image generation is not part of the merchant offering yet: quality
// isn't validated and the image providers carry real cost/quota limits. It is
// gated to ADMIN_EMAILS so it can be trialled on the owner's own account
// without exposing it — or its cost — to merchants.
import { withApi, ApiError } from "../_lib/core/respond.js";
import { checkAndConsume, COSTS } from "../_lib/core/meter.js";
import { generateProductImage, STYLE_PRESETS } from "../_lib/imageProvider.js";
import { requireAdmin } from "../_lib/core/session.js";
import { checkRateLimit } from "../_lib/core/rateLimit.js";

async function imageHandler(body, env, request) {
  const admin = await requireAdmin(request, env);
  if (!admin) {
    throw new ApiError(403, "توليد الصور بمرحلة تجريبية مغلقة — غير متاح حالياً.", "FORBIDDEN");
  }

  const clientIp = request.headers.get("cf-connecting-ip") || "127.0.0.1";
  const rateCheck = await checkRateLimit(env, clientIp, "image_generation", 10, 60);
  if (!rateCheck.allowed) {
    // NOTE: json(data, status) — passing { status } here (as this line used to)
    // sets the HTTP status to an object and surfaces as a 502 instead of a 429.
    throw new ApiError(429, "تجاوزت حد طلبات التوليد المسموح به. يرجى الانتظار دقيقة.", "RATE_LIMITED");
  }

  // Metering stays on the admin's own merchant id — the beta consumes the
  // owner's quota, never a merchant's.
  const merchantId = admin.merchantId;
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

  const usage = await checkAndConsume(env, merchantId, COSTS.image);
  if (!usage.ok) {
    return {
      error: `خلص رصيدك المجاني اليوم (${usage.limit} رصيداً) — يتجدد الساعة 12 منتصف الليل بتوقيت UTC.`,
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

// POST /api/image
// body: { storeId, imageBase64, mime, style }
// imageBase64: raw base64 (no data: prefix) of the product photo, resized
// client-side to ≤512x512 (Workers AI reference-image constraint).
// style: one of STYLE_PRESETS keys ("طابع العميل" — customer brand identity).
import { withApi } from "../_lib/respond.js";
import { checkAndConsume, COSTS } from "../_lib/meter.js";
import { generateProductImage, STYLE_PRESETS } from "../_lib/imageProvider.js";

async function imageHandler(body, env) {
  const merchantId = (body.storeId || "default-store").toString().slice(0, 40);
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

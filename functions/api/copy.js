// POST /api/copy — تنسيق فقط: withApi ← حد معدل ← هوية ← تحقق ← حصة ← المجال.
// المنطق كله بـ`domain/copy.js` و`domain/copyParse.js` و`ai/prompts/seo.js`.
import { withApi } from "../_lib/core/respond.js";
import { generateProductCopy, TONE_LABELS } from "../_lib/domain/copy.js";
import { CopyParseError } from "../_lib/domain/copyParse.js";
import { checkAndConsumeMonthly, refundQuota } from "../_lib/core/meter.js";
import { requireCompletedAccount } from "../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../_lib/core/rateLimit.js";
import { logError } from "../_lib/core/errorLog.js";

// إعادة تصدير مؤقتة (تُزال بالمرحلة ٦) لمستوردي cron/bulk_process والاختبارات.
export { generateProductCopy, seedKeywords, approvedProfileBlock, TONE_LABELS } from "../_lib/domain/copy.js";
export { CopyParseError, parseSeoResponse, buildMetaDescription, fallbackSlug, acceptArabicVisionNotes } from "../_lib/domain/copyParse.js";
export { extractBalancedJson } from "../_lib/ai/parseModelJson.js";
export { buildSeoSystem, VISION_PROMPT, visionPromptFor, visionPromptFromTaxonomy } from "../_lib/ai/prompts/seo.js";

async function copyHandler(body, env, request) {
  // حد المعدل قبل أي هوية: نداء رؤية + نداء نص لكل طلب (SECURITY_AUDIT C2).
  const rl = await checkRateLimit(env, clientIp(request), "copy", 20, 60);
  if (!rl.allowed) {
    return { error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" };
  }

  // جلسة حقيقية إلزامية — لا دلو "default-store" المجهول (محرك تجاري كامل).
  const merchantId = await requireCompletedAccount(request, env, body.storeId);
  const name = (body.name || "").toString().trim().slice(0, 200);
  const price = (body.price || "").toString().trim().slice(0, 40);
  const tone = TONE_LABELS[body.tone] ? body.tone : "white";
  const category = (body.category || "").toString().trim().slice(0, 60);
  const features = (body.features || "").toString().trim().slice(0, 500);
  const existingDescription = (body.existingDescription || "").toString().trim().slice(0, 3000);
  const imageUrl = (body.imageUrl || "").toString().trim().slice(0, 500);
  // خيارات المنتج (ألوان/مقاسات) كما سُحبت من سلة — نص JSON من الكتالوج.
  const variants = (body.variants || "").toString().slice(0, 2000);

  if (!name) return { error: "أدخل اسم المنتج أولاً." };

  const usage = await checkAndConsumeMonthly(env, merchantId, "description");
  if (!usage.ok) {
    return { error: usage.scope === "global" ? "اكتملت سعة هالة لهذا اليوم — تتجدد بكرة تلقائياً، وما ضاع شي." : `وصلت حد اليوم لمتجرك (${usage.limit} أوصاف) — يتجدد بكرة تلقائياً.`, code: "OUT_OF_CREDITS", remaining: 0 };
  }

  let parsed;
  try {
    parsed = await generateProductCopy({
      env, merchantId, name, price, tone, category, features, existingDescription, imageUrl, variants, keywordsExtra: body.keywords
    });
  } catch (err) {
    // محاولة لم تُنتج وصفاً لا تُحسب من حد اليوم (٥ فقط).
    await refundQuota(env, merchantId, "description").catch(() => {});
    if (!(err instanceof CopyParseError)) throw err;
    logError({ env }, { requestId: null, path: "api/copy", code: "COPY_PARSE_FAILED", internal: "unparseable model output after one retry", storeId: merchantId });
    return { error: "تعذّر توليد وصف صالح لهذا المنتج. جرّب مرة ثانية أو أضف مزايا أوضح.", code: "COPY_PARSE_FAILED" };
  }

  return {
    ok: true,
    // صادق مع التاجر: بلا صورة (أو فشل تحليلها) الوصف مبني على النص فقط.
    usedImage: Boolean(parsed.usedImage),
    // تنبيه تصنيف (اقتراح للتاجر، لا تغيير) — null حين لا تعارض بيقين.
    categoryMismatch: parsed.categoryMismatch || null,
    result: parsed.copywriting.description,
    whatsapp: parsed.copywriting.whatsapp,
    seo: parsed.seo,
    copywriting: parsed.copywriting,
    specsTable: parsed.specsTable,
    faqs: parsed.faqs,
    imageAlt: parsed.imageAlt,
    tags: parsed.tags,
    tone,
    name,
    price,
    remaining: usage.remaining
  };
}

export const onRequestPost = withApi(copyHandler);

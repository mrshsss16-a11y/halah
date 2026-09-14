// POST /api/store/category — body: { productId, type }
// يطبّق التصنيف الذي اقترحته هالة، **بعد** ضغط التاجر عليه. لا مسار توليد
// يستدعيها: الاقتراح يُعرض، والتنفيذ قرار بشري (ARCHITECTURE §١ — تنسيق فقط).
import { withApi, ApiError } from "../../_lib/core/respond.js";
import { requireCompletedAccount } from "../../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { applyProductCategory } from "../../_lib/domain/productCategory.js";
import { KNOWN_TYPES } from "../../_lib/ai/productType.js";
import { logError } from "../../_lib/core/errorLog.js";

async function categoryHandler(body, env, request, requestId, context) {
  // كتابة على كتالوج سلة الحي — نفس سقف النشر (حد سلة ١ طلب/ثانية).
  const rl = await checkRateLimit(env, clientIp(request), "category_apply", 20, 60);
  if (!rl.allowed) {
    throw new ApiError(429, "محاولات كثيرة — انتظر دقيقة وكرر.", "RATE_LIMIT_EXCEEDED");
  }

  const merchantId = await requireCompletedAccount(request, env, body.storeId);
  const productId = String(body.productId || "").trim().slice(0, 40);
  const type = String(body.type || "").trim();
  const create = body.create === true;

  if (!productId) return { ok: false, error: "ما حددنا المنتج — أعد اختياره من «منتجاتي»." };
  // قائمة مغلقة: النوع لا يأتي من مدخل حر، بل مما اقترحته هالة نفسها.
  if (!KNOWN_TYPES.includes(type)) {
    return { ok: false, error: "نوع غير معروف — ما نطبّق تصنيفاً ما اقترحناه.", code: "UNKNOWN_TYPE" };
  }

  try {
    const out = await applyProductCategory(env, { merchantId, productId, type, create });
    return {
      ok: true,
      ...out,
      message: (out.created ? `أنشأنا تصنيف «${out.categoryName}» بمتجرك. ` : "") + (out.replaced
        ? `تم — التصنيف صار «${out.categoryName}» بدل «${out.replaced}».`
        : `تم — أُضيف تصنيف «${out.categoryName}».`)
    };
  } catch (err) {
    const status = Number(err?.status) || 0;
    if (err?.code === "CATEGORY_NOT_FOUND") return { ok: false, error: `ما فيه تصنيف «${type}» بمتجرك — تقدر هالة تنشئه وتطبّقه الآن.`, code: err.code, canCreate: true };
    if (status === 403) {
      return { ok: false, error: "التطبيق ما عنده صلاحية تعديل التصنيفات على متجرك.", code: "SCOPE_MISSING" };
    }
    if (status === 429) throw new ApiError(429, "سلة أوقفت الطلبات مؤقتاً — جرّب بعد دقيقة.", "SALLA_RATE_LIMITED");
    logError(context, { requestId, path: "store/category", code: "CATEGORY_APPLY_FAILED", storeId: merchantId, internal: String(err?.message || err).slice(0, 250) });
    return { ok: false, error: "ما قدرنا نطبّق التصنيف — جرّب مرة ثانية." };
  }
}

export const onRequestPost = withApi(categoryHandler);

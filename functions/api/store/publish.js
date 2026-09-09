// POST /api/store/publish — body: { storeId?, productId, description, seo?, copywriting?, faqs? }
// النشر الفردي من الاستوديو: نفس حقول سلة التي يستخدمها النشر الجماعي
// (domain/sallaProductPayload.js) — الوصف HTML منظّم + subtitle + metadata_title +
// metadata_description. كان يرسل الوصف وحده ويُسقط السيو الذي عرضه للتاجر.
import { withApi, ApiError } from "../../_lib/core/respond.js";
import { requireCompletedAccount } from "../../_lib/core/session.js";
import { buildSallaProductFields } from "../../_lib/domain/sallaProductPayload.js";
import { logError } from "../../_lib/core/errorLog.js";
// N6 — P48 كان نصف مغلق: النشر يكتب على كتالوج سلة الحي بلا أي حد معدل.
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { findCatalogBySallaProductId, markPublished } from "../../_lib/domain/catalog.js";
import { updateSallaProduct } from "../../_lib/domain/publish.js";

async function publishHandler(body, env, request, requestId, context) {
  // Writing onto the merchant's live Salla catalogue is a "real operation":
  // session required, and a completed account on top (403 ACCOUNT_REQUIRED).
  // N6 — ٣٠ عملية نشر بالدقيقة لكل IP: يمنع حلقة نشر مندفعة من إغراق سلة
  // (وجرّ حظر ٤٢٩ على التاجر) قبل أن يصل الطلب لواجهتهم أصلاً.
  const publishRate = await checkRateLimit(env, clientIp(request), "publish", 30, 60);
  if (!publishRate.allowed) {
    throw new ApiError(429, "طلبات نشر كثيرة جداً — انتظر دقيقة وكرر المحاولة.", "RATE_LIMIT_EXCEEDED");
  }

  const merchantId = await requireCompletedAccount(request, env, body.storeId);
  const productId = (body.productId || "").toString().slice(0, 40);
  const description = (body.description || "").toString().slice(0, 5000).trim();

  if (!merchantId || !productId || !description) {
    return { ok: false, error: "storeId وproductId والوصف كلها مطلوبة." };
  }

  const { fields, descriptionOnly, hasSeo } = buildSallaProductFields({
    description,
    excerpt: body.copywriting?.excerpt || "",
    highlights: Array.isArray(body.copywriting?.highlights) ? body.copywriting.highlights.slice(0, 8) : [],
    faqs: Array.isArray(body.faqs) ? body.faqs.slice(0, 5) : [],
    seo: body.seo && typeof body.seo === "object" ? body.seo : null
  });

  let seoApplied = hasSeo;
  try {
    await updateSallaProduct(env, merchantId, productId, fields);
  } catch (err) {
    if (Number(err?.status) === 422 && hasSeo) {
      logError(context, { requestId, path: "store/publish", code: "SALLA_SEO_FIELDS_REJECTED", storeId: merchantId, internal: String(err?.message || err).slice(0, 250) });
      await updateSallaProduct(env, merchantId, productId, descriptionOnly);
      seoApplied = false;
    } else if (Number(err?.status) === 429) {
      throw new ApiError(429, "سلة أوقفت الطلبات مؤقتاً — جرّب بعد دقيقة.", "SALLA_RATE_LIMITED", String(err?.message || err).slice(0, 250));
    } else {
      throw err;
    }
  }

  // إن كان لهذا المنتج صف كتالوج (مسحوب من سلة، له وصف أصلي محفوظ) نُعلم
  // هالة أنه نُشر عليه — هذا وحده يجعل التراجع (decide.js action=revert) ممكناً؛
  // منتج بلا صف كتالوج (رفع يدوي CSV) لا نملك أصله فلا تراجع صادق له.
  let revertAvailable = false;
  try {
    const catalogRow = await findCatalogBySallaProductId(env, { merchantId, sallaProductId: productId });
    if (catalogRow?.sku) {
      await markPublished(env, { merchantId, sku: catalogRow.sku, description });
      revertAvailable = true;
    }
  } catch (err) {
    logError(context, { requestId, path: "store/publish", code: "PUBLISH_MARK_FAILED", storeId: merchantId, internal: String(err?.message || err).slice(0, 250) });
  }

  return { ok: true, productId, seoApplied, revertAvailable };
}

export const onRequestPost = withApi(publishHandler);

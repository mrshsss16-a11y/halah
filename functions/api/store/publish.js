// POST /api/store/publish — body: { storeId?, productId, description, seo?, copywriting?, faqs? }
// النشر الفردي من الاستوديو: نفس حقول سلة التي يستخدمها النشر الجماعي
// (services/sallaProductPayload.js) — الوصف HTML منظّم + subtitle + metadata_title +
// metadata_description. كان يرسل الوصف وحده ويُسقط السيو الذي عرضه للتاجر.
import { withApi, ApiError } from "../../_lib/core/respond.js";
import { updateProduct } from "../../_lib/integrations/salla.js";
import { requireCompletedAccount } from "../../_lib/core/session.js";
import { buildSallaProductFields } from "../../_lib/services/sallaProductPayload.js";
import { logError } from "../../_lib/core/errorLog.js";

async function publishHandler(body, env, request, requestId, context) {
  // Writing onto the merchant's live Salla catalogue is a "real operation":
  // session required, and a completed account on top (403 ACCOUNT_REQUIRED).
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
    await updateProduct(env, merchantId, productId, fields);
  } catch (err) {
    if (Number(err?.status) === 422 && hasSeo) {
      logError(context, { requestId, path: "store/publish", code: "SALLA_SEO_FIELDS_REJECTED", storeId: merchantId, internal: String(err?.message || err).slice(0, 250) });
      await updateProduct(env, merchantId, productId, descriptionOnly);
      seoApplied = false;
    } else if (Number(err?.status) === 429) {
      throw new ApiError(429, "سلة أوقفت الطلبات مؤقتاً — جرّب بعد دقيقة.", "SALLA_RATE_LIMITED", String(err?.message || err).slice(0, 250));
    } else {
      throw err;
    }
  }
  return { ok: true, productId, seoApplied };
}

export const onRequestPost = withApi(publishHandler);

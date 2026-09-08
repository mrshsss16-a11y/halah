// POST /api/store/publish — body: { storeId, productId, description, seo? }
// Closes the loop: AI-generated copy from the dashboard written straight onto
// the live Salla product (requires products.read_write scope).
//
// حقول SEO (2026-09-08): كانت هالة تولّد عنوان SEO ووصف ميتا، **تعرضهما
// للتاجر**، ثم تنشر الوصف وحده — فيرى التاجر حقولاً سيو ما تصل متجره أبداً.
// المسار الجماعي (`_lib/services/publishApproved.js`) كان ينشرها منذ البداية،
// فكان المساران يتناقضان بنفس الوعد. رصده صاحب المشروع بصفحة منتج حية.
//
// نفس تدرّج المسار الجماعي حرفياً: لو رفضت سلة `metadata` (٤٢٢) نعيد المحاولة
// بالوصف وحده مرة واحدة — الوصف هو الوعد الأساسي، وSEO تحسين فوقه، وإسقاط
// النشر كله بسبب حقل ثانوي أسوأ من نشره ناقصاً.
import { withApi } from "../../_lib/core/respond.js";
import { updateProduct } from "../../_lib/integrations/salla.js";
import { requireCompletedAccount } from "../../_lib/core/session.js";

async function publishHandler(body, env, request) {
  // Writing onto the merchant's live Salla catalogue is a "real operation":
  // session required, and a completed account on top (403 ACCOUNT_REQUIRED).
  const merchantId = await requireCompletedAccount(request, env, body.storeId);
  const productId = (body.productId || "").toString().slice(0, 40);
  const description = (body.description || "").toString().slice(0, 5000);

  if (!merchantId || !productId || !description) {
    return { ok: false, error: "storeId وproductId والوصف كلها مطلوبة." };
  }

  const fields = { description };
  const seoTitle = String(body?.seo?.seoTitle || body?.seo?.title || "").trim().slice(0, 120);
  const seoMeta = String(body?.seo?.metaDescription || "").trim().slice(0, 320);
  const withMeta = seoTitle || seoMeta
    ? {
        ...fields,
        metadata: {
          ...(seoTitle ? { title: seoTitle } : {}),
          ...(seoMeta ? { description: seoMeta } : {})
        }
      }
    : fields;

  try {
    await updateProduct(env, merchantId, productId, withMeta);
  } catch (err) {
    const status = Number(String(err?.message || err).match(/HTTP (\d{3})/)?.[1] || 0);
    if (status === 422 && withMeta.metadata) {
      await updateProduct(env, merchantId, productId, fields);
      return { ok: true, productId, seoPublished: false };
    }
    throw err;
  }
  return { ok: true, productId, seoPublished: Boolean(withMeta.metadata) };
}

export const onRequestPost = withApi(publishHandler);

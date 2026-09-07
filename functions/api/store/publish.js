// POST /api/store/publish — body: { storeId, productId, description }
// Closes the loop: AI-generated copy from studio.html written straight onto
// the live Salla product (requires products.read_write scope).
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

  await updateProduct(env, merchantId, productId, { description });
  return { ok: true, productId };
}

export const onRequestPost = withApi(publishHandler);

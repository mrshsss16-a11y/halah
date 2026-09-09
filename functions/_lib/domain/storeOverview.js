// نظرة عامة على المتجر للوحة التاجر (المرحلة ٤: نُقل من `api/store/overview.js`).
//
// يجمع بيانات حقيقية: منتجات وطلبات سلة (Merchant API الحي)، منتجات Trendyol
// المُزامَنة (D1)، والسلات المتروكة. **كل قسم يتدهور مستقلاً** — منصة معطّلة أو
// غير مربوطة يجب ألا تُفرِغ اللوحة كلها.
import { getMerchant } from "./accounts.js";
import { getTokens } from "./salla.js";
import { getPlatformConnection, listAbandonedCarts, listSyncedProducts } from "./platforms.js";
import { listProducts, listOrders } from "../integrations/salla.js";

/**
 * @param {(code:string, err:unknown)=>object} onSectionError يسجّل ويعيد ما
 *   يُدمج بجسم خطأ القسم (`{code, requestId}`). القسم المتدهور يخبر التاجر
 *   بالعربية أي جزء فشل — لا نص المزوّد/D1 الخام (إنجليزي وقد يحمل معرّفات).
 */
export async function buildStoreOverview(env, merchantId, onSectionError) {
  const merchant = merchantId ? await getMerchant(env, merchantId) : null;
  if (!merchant) {
    return { linked: false, error: "المتجر غير مرتبط — اربط متجرك من صفحة الإعداد أولاً." };
  }

  const [sallaTokens, tyConn] = await Promise.all([
    getTokens(env, merchant.id, "salla"),
    getPlatformConnection(env, merchant.id, "trendyol")
  ]);

  const result = {
    linked: true,
    storeId: merchant.id,
    storeName: merchant.store_name,
    platforms: { salla: Boolean(sallaTokens), trendyol: Boolean(tyConn) },
    products: [],
    orders: [],
    trendyolProducts: [],
    abandonedCarts: [],
    errors: {}
  };

  const section = async (key, message, code, fn) => {
    try {
      await fn();
    } catch (err) {
      result.errors[key] = { message, ...onSectionError(code, err) };
    }
  };

  if (sallaTokens) {
    await section("sallaProducts", "تعذّر جلب المنتجات من سلة الحين. حدّث الصفحة بعد شوي.", "OVERVIEW_SALLA_PRODUCTS_FAILED", async () => {
      const res = await listProducts(env, merchant.id);
      result.products = (res.data || []).map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price && p.price.amount,
        quantity: p.quantity,
        status: p.status,
        image: (p.images && p.images[0] && p.images[0].url) || null
      }));
    });
    await section("sallaOrders", "تعذّر جلب الطلبات من سلة الحين. حدّث الصفحة بعد شوي.", "OVERVIEW_SALLA_ORDERS_FAILED", async () => {
      const res = await listOrders(env, merchant.id);
      result.orders = (res.data || []).map((o) => ({
        id: o.id,
        reference: o.reference_id,
        status: o.status && (o.status.name || o.status),
        total: o.amounts && o.amounts.total && o.amounts.total.amount,
        customer: o.customer && `${o.customer.first_name || ""} ${o.customer.last_name || ""}`.trim(),
        date: o.date && (o.date.date || o.date)
      }));
    });
  }

  await section("trendyol", "تعذّر جلب منتجات Trendyol الحين. حدّث الصفحة بعد شوي.", "OVERVIEW_TRENDYOL_FAILED", async () => {
    result.trendyolProducts = await listSyncedProducts(env, merchant.id, "trendyol");
  });

  await section("carts", "تعذّر جلب السلات المتروكة الحين. حدّث الصفحة بعد شوي.", "OVERVIEW_CARTS_FAILED", async () => {
    result.abandonedCarts = (await listAbandonedCarts(env, merchant.id)).map((c) => ({
      id: c.id,
      customerName: c.customer_name,
      customerPhone: c.customer_phone,
      items: JSON.parse(c.items_json || "[]"),
      total: c.total,
      createdAt: c.created_at
    }));
  });

  return result;
}

// POST /api/store/overview — body: { storeId }
// Aggregates real store data for dashboard.html: Salla products/orders (live
// Merchant API), Trendyol synced products (D1), abandoned carts, recent
// webhook events. Every section degrades independently — one platform being
// down or unlinked must not blank the whole dashboard.
import { withApi } from "../../_lib/core/respond.js";
import { getMerchant, getTokens, getPlatformConnection, listAbandonedCarts } from "../../_lib/core/db.js";
import { listProducts, listOrders } from "../../_lib/integrations/salla.js";
import { resolveStoreId } from "../../_lib/core/session.js";
import { logError } from "../../_lib/core/errorLog.js";

// A degraded section must tell the merchant, in Arabic, which part failed —
// never the raw provider/D1 error text (English, and able to embed Salla's
// internal ids or echoed request fields). Detail goes to the error log,
// keyed by the same requestId the response already carries.
function sectionFailure(env, { requestId, storeId, code, err }) {
  logError({ env }, {
    requestId,
    path: "store/overview",
    code,
    storeId,
    internal: String((err && err.message) || err).slice(0, 300)
  });
  return { code, requestId };
}

async function overviewHandler(body, env, request, requestId) {
  const merchantId = await resolveStoreId(request, env, body.storeId);
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

  if (sallaTokens) {
    try {
      const productsRes = await listProducts(env, merchant.id);
      result.products = (productsRes.data || []).map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price && p.price.amount,
        quantity: p.quantity,
        status: p.status,
        image: (p.images && p.images[0] && p.images[0].url) || null
      }));
    } catch (err) {
      result.errors.sallaProducts = {
        message: "تعذّر جلب المنتجات من سلة الحين. حدّث الصفحة بعد شوي.",
        ...sectionFailure(env, { requestId, storeId: merchant.id, code: "OVERVIEW_SALLA_PRODUCTS_FAILED", err })
      };
    }
    try {
      const ordersRes = await listOrders(env, merchant.id);
      result.orders = (ordersRes.data || []).map((o) => ({
        id: o.id,
        reference: o.reference_id,
        status: o.status && (o.status.name || o.status),
        total: o.amounts && o.amounts.total && o.amounts.total.amount,
        customer: o.customer && `${o.customer.first_name || ""} ${o.customer.last_name || ""}`.trim(),
        date: o.date && (o.date.date || o.date)
      }));
    } catch (err) {
      result.errors.sallaOrders = {
        message: "تعذّر جلب الطلبات من سلة الحين. حدّث الصفحة بعد شوي.",
        ...sectionFailure(env, { requestId, storeId: merchant.id, code: "OVERVIEW_SALLA_ORDERS_FAILED", err })
      };
    }
  }

  try {
    const { results } = await env.DB.prepare(
      `SELECT external_id, title, price, stock, sync_status, last_sync_at
       FROM product_sync WHERE merchant_id = ? AND platform = 'trendyol'
       ORDER BY last_sync_at DESC LIMIT 20`
    )
      .bind(merchant.id)
      .all();
    result.trendyolProducts = results || [];
  } catch (err) {
    result.errors.trendyol = {
      message: "تعذّر جلب منتجات Trendyol الحين. حدّث الصفحة بعد شوي.",
      ...sectionFailure(env, { requestId, storeId: merchant.id, code: "OVERVIEW_TRENDYOL_FAILED", err })
    };
  }

  try {
    result.abandonedCarts = (await listAbandonedCarts(env, merchant.id)).map((c) => ({
      id: c.id,
      customerName: c.customer_name,
      customerPhone: c.customer_phone,
      items: JSON.parse(c.items_json || "[]"),
      total: c.total,
      createdAt: c.created_at
    }));
  } catch (err) {
    result.errors.carts = {
      message: "تعذّر جلب السلات المتروكة الحين. حدّث الصفحة بعد شوي.",
      ...sectionFailure(env, { requestId, storeId: merchant.id, code: "OVERVIEW_CARTS_FAILED", err })
    };
  }

  return result;
}

export const onRequestPost = withApi(overviewHandler);

// POST /api/trendyol/sync
// body: { storeId, action: "push-products"|"price-stock"|"batch-status"|"orders", ... }
//
// - push-products: items[] → createProducts v2 (async), batchRequestId saved
//   on each product_sync row for later polling.
// - price-stock: items[{barcode,quantity,salePrice,listPrice}] — Trendyol
//   forbids repeating the same payload within 15 minutes; enforced here via
//   payload hash stored on product_sync.
// - batch-status: { batchRequestId } → poll async result, update sync_status.
// - orders: pull one page of shipment packages.
import { withApi } from "../../_lib/core/respond.js";
import { getPlatformConnection } from "../../_lib/core/db.js";
import { createProducts, updatePriceAndInventory, getBatchResult, getShipmentPackages } from "../../_lib/integrations/trendyol.js";
import { resolveStoreId } from "../../_lib/core/session.js";

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function syncHandler(body, env, request) {
  // resolveStoreId: a logged-in session always overrides a client-claimed
  // storeId, so an attacker who knows another merchant's id can never read
  // their orders or push/overwrite their product listings via this endpoint.
  const merchantId = await resolveStoreId(request, env, body.storeId);

  const conn = await getPlatformConnection(env, merchantId, "trendyol");
  if (!conn) return { ok: false, error: "المتجر غير مرتبط بـ Trendyol — اربطه من صفحة الإعداد أولاً." };

  const action = body.action || "";

  if (action === "push-products") {
    const items = Array.isArray(body.items) ? body.items.slice(0, 1000) : [];
    if (!items.length) return { ok: false, error: "لا توجد منتجات للدفع." };
    const result = await createProducts(conn, items);
    const batchId = result.batchRequestId || null;
    for (const item of items) {
      await env.DB.prepare(
        `INSERT INTO product_sync (merchant_id, platform, external_id, title, price, stock, batch_request_id, sync_status)
         VALUES (?, 'trendyol', ?, ?, ?, ?, ?, 'pending')
         ON CONFLICT (merchant_id, platform, external_id) DO UPDATE SET
           title = excluded.title, price = excluded.price, stock = excluded.stock,
           batch_request_id = excluded.batch_request_id, sync_status = 'pending',
           last_sync_at = datetime('now')`
      )
        .bind(merchantId, String(item.barcode), item.title || null, item.salePrice || null, item.quantity || null, batchId)
        .run();
    }
    return { ok: true, batchRequestId: batchId, count: items.length };
  }

  if (action === "price-stock") {
    const items = Array.isArray(body.items) ? body.items.slice(0, 1000) : [];
    if (!items.length) return { ok: false, error: "لا توجد عناصر للتحديث." };
    const hash = await sha256Hex(JSON.stringify(items));
    const dup = await env.DB.prepare(
      `SELECT 1 FROM product_sync WHERE merchant_id = ? AND platform = 'trendyol'
       AND payload_hash = ? AND last_sync_at > datetime('now', '-15 minutes') LIMIT 1`
    )
      .bind(merchantId, hash)
      .first();
    if (dup) {
      return { ok: false, error: "نفس طلب التحديث أُرسل قبل أقل من 15 دقيقة — Trendyol يمنع التكرار. انتظر ثم أعد المحاولة." };
    }
    const result = await updatePriceAndInventory(conn, items);
    for (const item of items) {
      await env.DB.prepare(
        `INSERT INTO product_sync (merchant_id, platform, external_id, price, stock, batch_request_id, payload_hash, sync_status)
         VALUES (?, 'trendyol', ?, ?, ?, ?, ?, 'pending')
         ON CONFLICT (merchant_id, platform, external_id) DO UPDATE SET
           price = COALESCE(excluded.price, price), stock = COALESCE(excluded.stock, stock),
           batch_request_id = excluded.batch_request_id, payload_hash = excluded.payload_hash,
           sync_status = 'pending', last_sync_at = datetime('now')`
      )
        .bind(merchantId, String(item.barcode), item.salePrice ?? null, item.quantity ?? null, result.batchRequestId || null, hash)
        .run();
    }
    return { ok: true, batchRequestId: result.batchRequestId || null, count: items.length };
  }

  if (action === "batch-status") {
    const batchId = (body.batchRequestId || "").toString();
    if (!batchId) return { ok: false, error: "batchRequestId مفقود." };
    const result = await getBatchResult(conn, batchId);
    const failed = (result.items || []).filter((i) => i.status === "FAILED");
    const done = result.status === "COMPLETED" || (result.itemCount && result.items && result.items.length === result.itemCount);
    if (done) {
      await env.DB.prepare(
        `UPDATE product_sync SET sync_status = 'synced', last_sync_at = datetime('now')
         WHERE merchant_id = ? AND batch_request_id = ? AND sync_status = 'pending'`
      )
        .bind(merchantId, batchId)
        .run();
      for (const f of failed) {
        const barcode = f.requestItem && f.requestItem.barcode;
        if (barcode) {
          await env.DB.prepare(
            `UPDATE product_sync SET sync_status = 'error' WHERE merchant_id = ? AND external_id = ?`
          )
            .bind(merchantId, String(barcode))
            .run();
        }
      }
    }
    return { ok: true, done, failedCount: failed.length, raw: result };
  }

  if (action === "orders") {
    const page = Number(body.page) || 0;
    const result = await getShipmentPackages(conn, page, 20);
    return { ok: true, orders: result.content || [], totalPages: result.totalPages || 0 };
  }

  return { ok: false, error: `action غير معروف: ${action}` };
}

export const onRequestPost = withApi(syncHandler);

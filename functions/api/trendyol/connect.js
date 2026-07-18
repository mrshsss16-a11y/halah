// POST /api/trendyol/connect
// body: { storeId?, sellerId, apiKey, apiSecret, environment? }
// Validates the credentials with a REAL API call before saving anything —
// a bad key never lands in the database. Creates the merchant row when the
// store isn't linked to anything yet.
import { withApi } from "../../_lib/respond.js";
import { verifyConnection } from "../../_lib/trendyol.js";
import { getMerchant, savePlatformConnection } from "../../_lib/db.js";
import { resolveStoreId } from "../../_lib/session.js";

async function connectHandler(body, env, request) {
  const sellerId = (body.sellerId || "").toString().trim();
  const apiKey = (body.apiKey || "").toString().trim();
  const apiSecret = (body.apiSecret || "").toString().trim();
  const environment = body.environment === "stage" ? "stage" : "prod";

  if (!sellerId || !apiKey || !apiSecret) {
    return { ok: false, error: "أدخل رقم البائع والمفتاحين كاملين." };
  }

  const conn = { seller_id: sellerId, api_key: apiKey, api_secret: apiSecret, environment };

  try {
    await verifyConnection(conn);
  } catch (err) {
    const msg = String(err.message || err);
    if (msg.includes("401")) {
      return { ok: false, error: "المفاتيح غير صحيحة (401) — تأكد من API Key وSecret من لوحة البائع (مستخدم Admin فقط يشوفها)." };
    }
    if (msg.includes("403")) {
      return { ok: false, error: "الوصول مرفوض (403) — تأكد من رقم البائع (Seller ID) ومطابقته للمفاتيح." };
    }
    return { ok: false, error: `تعذر التحقق من الاتصال: ${msg.slice(0, 120)}` };
  }

  // Credentials verified — persist. resolveStoreId ensures a logged-in
  // session always wins over a client-claimed storeId, so an attacker who
  // knows another merchant's id can never hijack their Trendyol connection.
  let merchantId = await resolveStoreId(request, env, body.storeId);
  const existing = await getMerchant(env, merchantId);
  if (!existing) {
    merchantId = `m_${crypto.randomUUID().slice(0, 12)}`;
    await env.DB.prepare(
      "INSERT INTO merchants (id, trendyol_seller_id, store_name) VALUES (?, ?, ?)"
    )
      .bind(merchantId, sellerId, body.storeName || null)
      .run();
  } else if (!existing.trendyol_seller_id) {
    await env.DB.prepare("UPDATE merchants SET trendyol_seller_id = ? WHERE id = ?")
      .bind(sellerId, merchantId)
      .run();
  }

  await savePlatformConnection(env, {
    merchantId,
    platform: "trendyol",
    sellerId,
    apiKey,
    apiSecret,
    environment,
    storeName: body.storeName || null
  });

  return { ok: true, storeId: merchantId, environment };
}

export const onRequestPost = withApi(connectHandler);

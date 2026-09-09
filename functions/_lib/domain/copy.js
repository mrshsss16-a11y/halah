// مجال النسخ التسويقي: سجل ما وُلّد سابقاً لمنع التكرار.
// نُقل من core/db.js بالمرحلة ٣ بلا تغيير سلوكي. (منطق `api/copy.js` نفسه
// ينتقل إلى هنا بالمرحلة ٤ — ARCHITECTURE §٢.)

export async function recentCopy(env, merchantId, limit = 8) {
  if (!env.DB) return [];
  const { results } = await env.DB.prepare(
    "SELECT product_name, opening, keywords FROM copy_history WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?"
  )
    .bind(merchantId, limit)
    .all();
  return results || [];
}

export async function saveCopy(env, { merchantId, productName, opening, keywords }) {
  if (!env.DB) return;
  await env.DB.prepare(
    "INSERT INTO copy_history (merchant_id, product_name, opening, keywords) VALUES (?, ?, ?, ?)"
  )
    .bind(merchantId, productName || null, (opening || "").slice(0, 80), (keywords || []).join(", "))
    .run();
}

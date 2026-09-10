// كتابة منتج واحد بالكتالوج — مسار ويبهوك سلة، لا مسار سحب صفحات.
//
// أحداث `product.created` / `product.updated` / `product.deleted` تحمل المنتج
// بحمولتها كاملاً، فلا نُنادي سلة من جديد: صفر طلب إضافي، وصفر استهلاك من
// حدّ الطلب/الثانية. الكتالوج يبقى محدَّثاً بلا أن يضغط التاجر «تحديث».
//
// مستقلة عن `catalog.js` لتبقى تحت سقف ٤٠٠ سطر (ARCHITECTURE §٤)، وتشترك
// معها بمُطبِّع الصف نفسه فلا يتفرّع شكل البيانات.
import { toCatalogRow } from "./catalog.js";
import { withVariantsFallback, VCOL } from "./migrationGap.js";
import { DomainError } from "../core/errors.js";

function requireDb(env) {
  if (!env?.DB) throw new DomainError("قاعدة البيانات غير متاحة.", "DB_UNAVAILABLE");
  return env.DB;
}

function requireMerchantId(merchantId) {
  const mid = String(merchantId ?? "").trim();
  if (!mid) throw new DomainError("معرّف التاجر غير محدد.", "MERCHANT_REQUIRED");
  return mid;
}

const text = (v, max) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

/**
 * كتابة/تحديث منتج واحد.
 *
 * نفس عقد `syncCatalogPage`: منتج بلا SKU لا يُدرَج (المفتاح الأساسي يتطلبه)،
 * و`original_description` يُكتب مرة واحدة فقط حتى يبقى «التراجع» صادقاً بعد
 * أن ينشر هالة وصفاً.
 */
export async function upsertCatalogProduct(env, { merchantId, product } = {}) {
  const mid = requireMerchantId(merchantId);
  const db = requireDb(env);
  const row = toCatalogRow(product);
  if (!row) return { upserted: false, reason: "no-sku-or-name" };

  await withVariantsFallback(async (v) => {
    await db
      .prepare(
        `INSERT INTO store_products
           (merchant_id, sku, salla_product_id, name, price, category, current_description, original_description, image_url${VCOL(v)}, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?${v ? ", ?" : ""}, datetime('now'))
         ON CONFLICT(merchant_id, sku) DO UPDATE SET
           salla_product_id = excluded.salla_product_id,
           name = excluded.name,
           price = excluded.price,
           category = excluded.category,
           current_description = excluded.current_description,
           original_description = COALESCE(store_products.original_description, excluded.current_description),
           image_url = excluded.image_url,${v ? " variants = excluded.variants," : ""}
           synced_at = datetime('now')`
      )
      .bind(
        ...(v
          ? [mid, row.sku, row.sallaProductId, row.name, row.price, row.category, row.currentDescription, row.currentDescription, row.imageUrl, row.variants]
          : [mid, row.sku, row.sallaProductId, row.name, row.price, row.category, row.currentDescription, row.currentDescription, row.imageUrl])
      )
      .run();
    return true;
  });
  return { upserted: true, sku: row.sku };
}

/**
 * حذف منتج من الكتالوج.
 *
 * الحمولة قد تحمل `sku` أو `id` فقط، فنقبل الاثنين. **مقيَّد بالتاجر دائماً**:
 * SKU ليس فريداً عالمياً بين المتاجر.
 */
export async function deleteCatalogProduct(env, { merchantId, sku, sallaProductId } = {}) {
  const mid = requireMerchantId(merchantId);
  const db = requireDb(env);
  const key = text(sku, 100);
  const pid = text(sallaProductId, 60);
  if (!key && !pid) return { deleted: 0 };

  const res = key
    ? await db.prepare("DELETE FROM store_products WHERE merchant_id = ? AND sku = ?").bind(mid, key).run()
    : await db.prepare("DELETE FROM store_products WHERE merchant_id = ? AND salla_product_id = ?").bind(mid, pid).run();
  return { deleted: Number(res?.meta?.changes || 0) };
}

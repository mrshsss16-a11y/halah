// أحداث منتجات سلة — تحديث الكتالوج فور تغيّره بالمتجر.
//
// `product.created` / `product.updated` / `product.deleted`. الحمولة تحمل
// المنتج كاملاً، فلا نُنادي سلة من جديد: صفر طلب إضافي وصفر استهلاك من حدّ
// الطلب/الثانية. النتيجة أن «منتجاتي» تبقى مطابقة لمتجرك بلا أن تضغط
// «تحديث المنتجات» أبداً.
//
// **الفشل هنا لا يُسقط الويبهوك**: يُسجَّل ويُمرَّر. سلة تعيد المحاولة على
// الفشل، والسحب اليدوي يبقى مساراً بديلاً دائماً — فلا حدث ضائع يعني كتالوجاً
// مكسوراً إلى الأبد.
import { upsertCatalogProduct, deleteCatalogProduct } from "./catalogProduct.js";
import { logError } from "../core/errorLog.js";

export async function handleProductEvent(env, { merchantId, event, data } = {}) {
  if (!merchantId || !data) return { handled: false };

  try {
    if (event === "product.deleted") {
      const out = await deleteCatalogProduct(env, {
        merchantId,
        sku: data.sku,
        sallaProductId: data.id
      });
      return { handled: true, ...out };
    }
    const out = await upsertCatalogProduct(env, { merchantId, product: data });
    return { handled: true, ...out };
  } catch (err) {
    logError({ env }, {
      requestId: null,
      path: "domain/sallaProductEvents",
      code: event === "product.deleted" ? "CATALOG_DELETE_FAILED" : "CATALOG_UPSERT_FAILED",
      storeId: merchantId,
      internal: `${event}: ${String(err?.message || err).slice(0, 200)}`
    });
    return { handled: false, error: true };
  }
}

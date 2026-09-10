// نظرة عامة على المتجر للوحة التاجر (المرحلة ٤: نُقل من `api/store/overview.js`).
//
// المنتجات فقط (2026-09-11). كان يجلب أيضاً طلبات سلة بأسماء العملاء، والسلات
// المتروكة بجوالاتهم، ومنتجات Trendyol — بينما المنتج المقدَّم لسلة «وصف منتجات»
// والأسئلة الشائعة تقول «لا نقرأ بيانات عملائك ولا طلباتك». الكود كان يكذّب
// الوثيقة، ومراجع سلة يقارن ما يُقرأ بالصلاحيات المطلوبة. أُزيلت القراءة لا
// الوثيقة: صلاحيات التطبيق منتجات وتصنيفات وإعدادات فقط، وما لا نطلبه لا نقرؤه.
//
// القسم الوحيد يتدهور مستقلاً: فشل سلة يعطي رسالة عربية لا لوحة فارغة.
import { getMerchant } from "../core/identity.js";
import { getTokens, getValidSallaToken } from "./salla.js";
import { listProducts } from "../integrations/salla.js";

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

  const sallaTokens = await getTokens(env, merchant.id, "salla");

  const result = {
    linked: true,
    storeId: merchant.id,
    storeName: merchant.store_name,
    platforms: { salla: Boolean(sallaTokens) },
    products: [],
    errors: {}
  };

  if (sallaTokens) {
    try {
      const res = await listProducts(await getValidSallaToken(env, merchant.id));
      result.products = (res.data || []).map((p) => ({
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
        ...onSectionError("OVERVIEW_SALLA_PRODUCTS_FAILED", err)
      };
    }
  }

  return result;
}

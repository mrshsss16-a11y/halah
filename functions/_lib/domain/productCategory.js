// تطبيق تصنيف صحيح على منتج بسلة — **بموافقة التاجر فقط**.
//
// هالة ترصد التعارض (ai/productType.js) وتعرضه؛ هذي الطبقة تنفّذ ما اعتمده
// التاجر بضغطة. لا تُستدعى تلقائياً من أي مسار توليد.
//
// القاعدة الحاكمة: **لا نمحو تصنيفاً لم نقصده.** سلة تستبدل مصفوفة
// `categories` كاملة عند الكتابة، فنقرأ تصنيفات المنتج أولاً، ونستبدل
// **التصنيف المتعارض وحده** بالتصنيف الصحيح، ونبقي الباقي كما هو. منتج قد
// ينتمي لـ«فساتين» و«وصل حديثاً» و«تخفيضات» — الأخيران ليسا خطأً.
import { listCategories, getProduct, updateProduct } from "../integrations/salla.js";
import { getValidSallaToken } from "./salla.js";
import { productTypeOf } from "../ai/productType.js";

const MAX_CATEGORY_PAGES = 5; // ٣٠٠ تصنيف — أكبر من أي متجر واقعي

/**
 * تصنيفات المتجر مسطّحة `{ id, name, type }` حيث `type` هو النوع المعروف
 * الذي يمثّله اسم التصنيف (أو `null` لتصنيف تسويقي مثل «وصل حديثاً»).
 */
async function loadStoreCategories(env, merchantId) {
  const token = await getValidSallaToken(env, merchantId);
  const out = [];
  for (let page = 1; page <= MAX_CATEGORY_PAGES; page++) {
    const res = await listCategories(token, page);
    const rows = res?.data || [];
    for (const c of rows) {
      if (!c?.id || !c?.name) continue;
      out.push({ id: c.id, name: String(c.name), type: productTypeOf(c.name) });
      // التصنيفات الفرعية تأتي متداخلة بنفس الرد.
      for (const sub of c.sub_categories || []) {
        if (sub?.id && sub?.name) out.push({ id: sub.id, name: String(sub.name), type: productTypeOf(sub.name) });
      }
    }
    const pg = res?.pagination;
    if (!pg || !pg.totalPages || page >= pg.totalPages) break;
  }
  return out;
}

/**
 * يطبّق التصنيف الصحيح. يرمي بخطأ عربي واضح حين لا يمكن التنفيذ بصدق:
 * لا تصنيف مطابق بالمتجر ⇒ التاجر ينشئه بنفسه، ولا نخترع واحداً.
 *
 * @returns {{ applied: true, categoryId, categoryName, replaced: string|null }}
 */
export async function applyProductCategory(env, { merchantId, productId, type }) {
  const token = await getValidSallaToken(env, merchantId);
  const categories = await loadStoreCategories(env, merchantId);

  const target = categories.find((c) => c.type === type);
  if (!target) {
    const err = new Error(`ما لقينا تصنيفاً باسم «${type}» بمتجرك — أنشئه من تصنيفات سلة ثم أعد المحاولة.`);
    err.code = "CATEGORY_NOT_FOUND";
    throw err;
  }

  const product = await getProduct(token, productId);
  const currentIds = (product?.data?.categories || [])
    .map((c) => (typeof c === "object" ? c?.id : c))
    .filter((id) => id != null);

  // نستبدل **التصنيفات المعروفة الخاطئة** وحدها؛ ما لا نوع له يبقى.
  const byId = new Map(categories.map((c) => [String(c.id), c]));
  let replaced = null;
  const kept = currentIds.filter((id) => {
    const known = byId.get(String(id));
    if (known?.type && known.type !== type) {
      replaced = known.name;
      return false;
    }
    return true;
  });

  const next = [...new Set([...kept.map(String), String(target.id)])];
  await updateProduct(token, productId, { categories: next.map(Number) });
  return { applied: true, categoryId: target.id, categoryName: target.name, replaced };
}

// بدء سحب الكتالوج: الصفحة الأولى فوراً + وظيفة للباقي.
// (المرحلة ٤: نُقل من `api/store/catalog/sync.js` بلا تغيير سلوكي.)
//
// لماذا صفحة واحدة متزامنة؟ حد سلة ١ طلب/ثانية لكل متجر، وتجاوزه يوقف اتصال
// المتجر **كاملاً** لا الطلب وحده. طلب واحد عند ضغطة زر يقع تحت الحد بأمان —
// والحلقة هي الممنوعة لا الطلب الأول. المكسب: التاجر يشوف منتجاته فوراً.
import { countCatalog, syncCatalogPage } from "./catalog.js";
import { createCatalogSyncJob, advanceCatalogSyncJob, getActiveJobByKind } from "./bulk.js";

/**
 * ترتيب الخطوات متعمَّد: **السحب أولاً ثم إنشاء الوظيفة**. لو فشلت الصفحة
 * الأولى لا تُنشأ وظيفة إطلاقاً، فلا يبقى شيء "شغّال" يوهم التاجر بنجاح ولا
 * يحجز حارس SYNC_ALREADY_RUNNING متجره بلا داعٍ.
 *
 * `syncPage` منفذ حقن للاختبار فقط (الافتراضي `syncCatalogPage` الحقيقية) —
 * يسمح بعدّ استدعاءات سلة بلا شبكة ولا توكنات.
 *
 * @returns {Promise<{imported:number, hasMore:boolean, skippedNoSku:number, jobId:string|null}>}
 */
export async function syncFirstPage(env, merchantId, { syncPage = syncCatalogPage } = {}) {
  // **استدعاء واحد لا حلقة** — الصفحة ١ فقط. الباقي للـcron (تِك/صفحة).
  const first = await syncPage(env, { merchantId, page: 1 });

  // متجر صغير خلص بصفحة واحدة: لا وظيفة معلّقة تنتظر تِكاً بلا شغل.
  if (!first.hasMore) {
    return { imported: first.imported, hasMore: false, skippedNoSku: first.skippedNoSku, jobId: null };
  }

  const jobId = `sync_${crypto.randomUUID().slice(0, 12)}`;
  await createCatalogSyncJob(env, { id: jobId, merchantId });
  // createCatalogSyncJob يبدأ الـcursor عند '1'؛ الصفحة ١ مسحوبة أصلاً فوق،
  // فنقدّمه للصفحة التالية ونسجّل ما استوردناه حتى لا يُعاد سحبها بأول تِك.
  await advanceCatalogSyncJob(env, { jobId, imported: first.imported, nextPage: first.nextPage });

  return { imported: first.imported, hasMore: true, skippedNoSku: first.skippedNoSku, jobId };
}

/** نص صادق: لا وعد بفورية غير متحققة، ولا إخفاء انتظار حقيقي. */
export function syncMessage({ imported, hasMore, skippedNoSku }) {
  if (hasMore) return `سحبنا أول ${imported} منتجاً — الباقي يوصل خلال دقائق.`;
  if (imported > 0) {
    const tail = skippedNoSku > 0 ? ` (${skippedNoSku} منتجاً بلا رمز SKU ما قدرنا نحفظه)` : "";
    return `تم سحب ${imported} منتجاً ✅${tail}`;
  }
  if (skippedNoSku > 0) {
    return `ما قدرنا نحفظ أي منتج: ${skippedNoSku} منتجاً بلا رمز SKU. أضف رموز SKU بسلة ثم أعد المحاولة.`;
  }
  return "ما لقينا منتجات بمتجرك على سلة.";
}

export { countCatalog };

/**
 * أول سحب للمنتجات **فور الربط** — بلا انتظار ضغطة زر.
 *
 * مرصود 2026-09-09: تاجر ربط متجراً جديداً فوجد «منتجاتي» فارغة وحكم أن
 * التطبيق "خرب" — السحب كان يبدأ فقط بضغطة زر لا يعرفها تاجر جديد. أول انطباع
 * = شاشة فارغة = تطبيق معطّل.
 *
 * صفحة واحدة فقط (نفس قاعدة syncFirstPage: حد سلة ١ط/ث)، والباقي للوظيفة.
 * الفشل هنا لا يُفشل المستدعي (الويبهوك): التوكن محفوظ والزر باقٍ كمسار بديل.
 * يُتجاهل إن كان سحب شغّالاً أصلاً (إعادة تصريح على متجر قائم).
 */
export async function kickoffFirstSync(env, merchantId, onError = () => {}) {
  try {
    if (await getActiveJobByKind(env, merchantId, "catalog_sync")) return;
    await syncFirstPage(env, merchantId);
  } catch (err) {
    onError("SALLA_FIRST_SYNC_FAILED", merchantId, String(err?.message || err).slice(0, 300));
  }
}

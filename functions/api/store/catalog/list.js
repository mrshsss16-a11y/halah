// GET /api/store/catalog/list?limit=&offset=&category=&storeId=
//
// جوهر المنتج: التاجر ما يكتب شيئاً. هذه النقطة تعطي واجهة "منتجاتي"
// بـdashboard.html صفحةً من كتالوج متجره المسحوب مسبقاً إلى D1، فيضغط بطاقة
// المنتج ويتولّد الوصف من صورته ووصفه الحالي مباشرة.
//
// صفر طلبات على سلة هنا — القراءة من store_products فقط (listCatalog)، فحد سلة
// (١ طلب/ثانية لكل متجر، وتجاوزه يوقف اتصال المتجر كاملاً) لا يُمَس بالتصفّح.
//
// العزل: merchantId يجي من requireCompletedAccount (الجلسة) لا من العميل،
// وlistCatalog تشترط merchant_id بكل استعلام. لا نثق بأي معرّف مرسَل.
import { withApi } from "../../../_lib/core/respond.js";
import { requireCompletedAccount } from "../../../_lib/core/session.js";
import { listCatalog, countCatalog } from "../../../_lib/services/catalog.js";
import { checkRateLimit, clientIp } from "../../../_lib/core/rateLimit.js";

const PAGE_LIMIT = 24;
const MAX_LIMIT = 60;

async function catalogListHandler(body, env, request) {
  // قراءة رخيصة لكن ليست مجانية (D1) — سقف معقول يمنع الاستنزاف.
  const rl = await checkRateLimit(env, clientIp(request), "catalog_list", 60, 60);
  if (!rl.allowed) {
    return { ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" };
  }

  const merchantId = await requireCompletedAccount(request, env, body.storeId);

  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(body.limit) || PAGE_LIMIT)));
  const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
  const category = typeof body.category === "string" && body.category.trim() ? body.category.trim() : null;

  // صفحة + ١: نعرف "فيه تالي" بلا COUNT ثانٍ على استعلام مُفلتَر.
  const rows = await listCatalog(env, { merchantId, limit: limit + 1, offset, category });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    ok: true,
    items: page.map((r) => ({
      sku: r.sku,
      name: r.name,
      price: r.price,
      category: r.category,
      imageUrl: r.image_url || null,
      // الوصف الحالي كامل — منه تولّد هالة النسخة المحسّنة بلا لصق يدوي.
      currentDescription: r.current_description || "",
      hasDescription: !!(r.current_description && String(r.current_description).trim())
    })),
    limit,
    offset,
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
    // العدد الكلي للكتالوج (بلا فلترة فئة) — تُظهره الواجهة بصدق.
    total: await countCatalog(env, { merchantId })
  };
}

export const onRequestGet = withApi(catalogListHandler);

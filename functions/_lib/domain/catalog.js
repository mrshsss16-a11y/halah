// المرحلة ١ من docs/PLAN_BULK_SEO.md — الطبقة الوحيدة اللي تلمس جدول store_products.
//
// لماذا طبقة خدمة (services/، معيار M1) بدل استعلامات موزّعة على الـendpoints:
// شرط العزل (merchant_id) مفروض بمكان واحد لا يمكن نسيانه — نفس منطق
// reviewQueue.js. أي استدعاء بلا merchantId يرمي فوراً (fail closed)، لا قيمة
// افتراضية ولا "تمرير برشاقة".
//
// حد سلة: ١ طلب/ثانية لكل متجر، وتجاوزه يوقف اتصال المتجر **كاملاً** لا الطلب
// وحده (.claude/skills/salla-integration/SKILL.md). لذلك syncCatalogPage تسحب
// **صفحة واحدة فقط** لكل استدعاء، والـcron يستدعيها مرة كل تِك.
import { DomainError } from "../core/errors.js";
import { listProducts } from "../integrations/salla.js";
import { withVariantsFallback, VCOL } from "./migrationGap.js";
import { getValidSallaToken } from "./salla.js";

// المرحلة ٦: المحوّل صار HTTP خالصاً (يأخذ توكناً جاهزاً، ق٢). المجال يجلب
// التوكن ويمرّره — نفس التوقيع القديم لمنفذ الحقن `fetchPage(env, merchantId, page)`
// حتى لا يتغيّر أي اختبار ولا أي سلوك.
const fetchSallaPage = async (env, merchantId, page) =>
  listProducts(await getValidSallaToken(env, merchantId), page);
import { CATALOG_LIST_LIMITS, clampLimit } from "../core/limits.js";

const UPSERT_CHUNK = 50; // D1 batch() — جولة واحدة بدل N

function invalid(message, internal) {
  return new DomainError(400, message, "CATALOG_INVALID", internal);
}

function requireMerchantId(merchantId) {
  if (typeof merchantId !== "string" || !merchantId.trim()) {
    throw invalid("المتجر غير محدد.", "catalog: missing merchantId");
  }
  return merchantId.trim();
}

function requireDb(env) {
  if (!env?.DB) {
    throw new DomainError(503, "الخدمة غير متاحة حالياً.", "DB_UNAVAILABLE", "catalog: DB binding missing");
  }
  return env.DB;
}

function text(value, max) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

/** سعر سلة يجي ككائن {amount, currency} أو رقم أو نص — نطبّعه لنص واحد. */
function normalizePrice(price) {
  if (price === null || price === undefined) return null;
  if (typeof price === "object") {
    const amount = price.amount ?? price.value ?? null;
    if (amount === null || amount === undefined) return null;
    const currency = text(price.currency, 10);
    return text(currency ? `${amount} ${currency}` : `${amount}`, 40);
  }
  return text(price, 40);
}

/** أول فئة من سلة: categories[].name أو category.name. */
function normalizeCategory(product) {
  const list = Array.isArray(product?.categories) ? product.categories : [];
  const first = list.find((c) => c && (c.name || typeof c === "string"));
  if (first) return text(typeof first === "string" ? first : first.name, 60);
  return text(product?.category?.name || product?.category, 60);
}

function normalizeImage(product) {
  const main = product?.main_image || product?.image?.url || product?.thumbnail;
  if (main) return text(typeof main === "string" ? main : main.url, 500);
  const images = Array.isArray(product?.images) ? product.images : [];
  const first = images.find((i) => i && (i.url || typeof i === "string"));
  if (!first) return null;
  return text(typeof first === "string" ? first : first.url, 500);
}

/**
 * يحوّل منتج سلة لصف store_products، أو null لو غير صالح للتخزين.
 * منتج بلا SKU **لا يُدرَج** — المفتاح الأساسي (merchant_id, sku) يتطلبه.
 * المستدعي يعدّه ويُبلغ عنه (المخاطرة ٧ بالخطة) بدل إسقاطه صامتاً.
 */

/**
 * خيارات المنتج (لون، مقاس…) بصيغة مضغوطة للبرومبت.
 *
 * سلة: `options[].name` + `options[].values[].name`. نحدّ بستة خيارات و١٢
 * قيمة لكل خيار — منتج بأربعين مقاساً يملأ البرومبت بلا فائدة، والمقصود
 * إعلام النموذج بالمدى المتاح لا سرده كاملاً.
 */
function normalizeVariants(product) {
  const options = Array.isArray(product?.options) ? product.options.slice(0, 6) : [];
  const out = [];
  for (const opt of options) {
    const name = text(opt?.name, 40);
    const values = (Array.isArray(opt?.values) ? opt.values : [])
      .slice(0, 12)
      .map((v) => text(v?.name || v?.display_value, 40))
      .filter(Boolean);
    if (name && values.length) out.push({ name, values });
  }
  return out.length ? JSON.stringify(out).slice(0, 2000) : null;
}

function toRow(product) {
  const sku = text(product?.sku, 100);
  const name = text(product?.name, 200);
  if (!sku || !name) return null;
  return {
    sku,
    name,
    sallaProductId: text(product?.id, 60),
    price: normalizePrice(product?.price),
    category: normalizeCategory(product),
    currentDescription: text(product?.description, 20000),
    imageUrl: normalizeImage(product),
    variants: normalizeVariants(product)
  };
}

/** استنتاج "هل فيه صفحة تالية" من شكل pagination المتغيّر بسلة. */
function hasMorePages(payload, page, received) {
  const p = payload?.pagination || {};
  const current = Number(p.currentPage ?? p.current_page ?? page);
  const totalPages = Number(p.totalPages ?? p.total_pages);
  if (Number.isFinite(totalPages) && totalPages > 0) return current < totalPages;
  // بلا pagination موثوقة: صفحة ممتلئة ⇒ غالباً فيه تالية.
  return received >= 60;
}

/**
 * يسحب **صفحة واحدة** من كتالوج سلة ويخزّنها بـstore_products.
 *
 * `fetchPage` منفذ حقن للاختبار فقط (الافتراضي سحب سلة الحقيقي) — يسمح
 * باختبار العزل وعدّ منتجات بلا SKU بلا شبكة ولا توكنات.
 *
 * @returns {Promise<{imported:number, skippedNoSku:number, received:number,
 *                    hasMore:boolean, nextPage:number|null, page:number}>}
 */
export async function syncCatalogPage(env, { merchantId, page = 1, fetchPage = fetchSallaPage } = {}) {
  const mid = requireMerchantId(merchantId);
  const db = requireDb(env);
  const pageNum = Math.max(1, Math.floor(Number(page) || 1));

  const payload = await fetchPage(env, mid, pageNum);
  const products = Array.isArray(payload?.data) ? payload.data : [];

  const rows = [];
  let skippedNoSku = 0;
  for (const product of products) {
    const row = toRow(product);
    if (!row) {
      skippedNoSku++;
      continue;
    }
    rows.push(row);
  }

  if (rows.length) {
    // العزل: merchant_id بكل صف مُدرَج، ومفتاح التعارض (merchant_id, sku)
    // يمنع أي كتابة فوق صف تاجر ثانٍ حتى لو تكرر SKU بين متجرين.
    const buildStmt = (v) => db.prepare(
      `INSERT INTO store_products
         (merchant_id, sku, salla_product_id, name, price, category, current_description, original_description, image_url${VCOL(v)}, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?${v ? ", ?" : ""}, datetime('now'))
       ON CONFLICT(merchant_id, sku) DO UPDATE SET
         salla_product_id = excluded.salla_product_id,
         name = excluded.name,
         price = excluded.price,
         category = excluded.category,
         current_description = excluded.current_description,
         -- الأصل يُكتب مرة واحدة فقط (migrations/0022) — السحب لا يمحو ما
         -- يحتاجه "التراجع" بعد نشر هالة.
         original_description = COALESCE(store_products.original_description, excluded.current_description),
         image_url = excluded.image_url,${v ? " variants = excluded.variants," : ""}
         synced_at = datetime('now')`
    );
    // نفس تحمّل فجوة الهجرة على الكتابة: سحب المنتجات لا يتوقف لأن عموداً
    // جديداً لم يُطبَّق بعد — يُكتب الصف بلا الخيارات، وتصل بأول سحب بعدها.
    await withVariantsFallback(async (v) => {
      const stmt = buildStmt(v);
      const batch = rows.map((r) => (v
        ? stmt.bind(mid, r.sku, r.sallaProductId, r.name, r.price, r.category, r.currentDescription, r.currentDescription, r.imageUrl, r.variants)
        : stmt.bind(mid, r.sku, r.sallaProductId, r.name, r.price, r.category, r.currentDescription, r.currentDescription, r.imageUrl)));
      for (let i = 0; i < batch.length; i += UPSERT_CHUNK) {
        await db.batch(batch.slice(i, i + UPSERT_CHUNK));
      }
      return true;
    });
  }

  const more = hasMorePages(payload, pageNum, products.length);
  // ختم "سُحب مرة على الأقل" — به تفرّق الواجهة بين "لم يبدأ" و"سُحب ولم يجد".
  // يُكتب هنا فقط لأن الوصول لهذا السطر يعني أن سلة ردّت بصفحة سليمة
  // (أي فشل شبكة/توكن/حد معدل يرمي قبله) — فالختم شهادة نجاح لا مرور.
  await env.DB.prepare("UPDATE merchants SET catalog_synced_at = datetime('now') WHERE id = ?")
    .bind(merchantId).run().catch(() => {});
  return {
    page: pageNum,
    received: products.length,
    imported: rows.length,
    skippedNoSku,
    hasMore: more,
    nextPage: more ? pageNum + 1 : null
  };
}

/** صفحة من كتالوج تاجر واحد — صفر طلبات سلة. */
export async function listCatalog(env, { merchantId, limit = CATALOG_LIST_LIMITS.default, offset = 0, category = null } = {}) {
  const mid = requireMerchantId(merchantId);
  const db = requireDb(env);
  const lim = clampLimit(limit, CATALOG_LIST_LIMITS);
  const off = Math.max(0, Math.floor(Number(offset) || 0));
  const cat = text(category, 60);

  const { results } = await withVariantsFallback((v) => (cat
    ? db
        .prepare(
          `SELECT sku, salla_product_id, name, price, category, current_description, image_url${VCOL(v)}, synced_at
           FROM store_products WHERE merchant_id = ? AND category = ?
           ORDER BY synced_at DESC, sku ASC LIMIT ? OFFSET ?`
        )
        .bind(mid, cat, lim, off)
        .all()
    : db
        .prepare(
          `SELECT sku, salla_product_id, name, price, category, current_description, image_url${VCOL(v)}, synced_at
           FROM store_products WHERE merchant_id = ?
           ORDER BY synced_at DESC, sku ASC LIMIT ? OFFSET ?`
        )
        .bind(mid, lim, off)
        .all()));

  return results || [];
}

/** منتج واحد بالـSKU — مشروط بالمتجر دائماً (SKU ليس فريداً عالمياً). */
export async function getCatalogItem(env, { merchantId, sku } = {}) {
  const mid = requireMerchantId(merchantId);
  const db = requireDb(env);
  const key = text(sku, 100);
  if (!key) throw invalid("رمز المنتج (SKU) غير محدد.", "catalog: missing sku");

  return withVariantsFallback((v) =>
    db
      .prepare(
        `SELECT sku, salla_product_id, name, price, category, current_description, original_description, hala_published_at, image_url${VCOL(v)}, synced_at
         FROM store_products WHERE merchant_id = ? AND sku = ?`
      )
      .bind(mid, key)
      .first()
  );
}

/**
 * صف الكتالوج المطابق لمعرّف منتج سلة — يستعمله النشر الفردي (store/publish.js)
 * لمعرفة إن كان لهذا المنتج صف كتالوج (وبالتالي وصف أصلي محفوظ يسمح بالتراجع)
 * قبل أن يدّعي للتاجر أن التراجع متاح.
 */
export async function findCatalogBySallaProductId(env, { merchantId, sallaProductId } = {}) {
  const mid = requireMerchantId(merchantId);
  const db = requireDb(env);
  const key = text(sallaProductId, 100);
  if (!key) return null;
  return db
    .prepare(
      `SELECT sku, salla_product_id, original_description FROM store_products
        WHERE merchant_id = ? AND salla_product_id = ?`
    )
    .bind(mid, key)
    .first();
}

/** عدّاد الكتالوج — يستعمله endpoint السحب لعرض حجم المتجر بصدق. */
export async function countCatalog(env, { merchantId } = {}) {
  const mid = requireMerchantId(merchantId);
  const db = requireDb(env);
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM store_products WHERE merchant_id = ?")
    .bind(mid)
    .first();
  return Number(row?.n || 0);
}

/**
 * أولوية الحصة (docs/PLAN_BULK_SEO.md §٦): أعلى عائد SEO أولاً —
 * بلا وصف إطلاقاً ← وصف قصير (< ٨٠ حرفاً) ← الأحدث سحباً. يُحسب من الجدول
 * المحلي، صفر طلبات سلة. المنتجات التي نشرت عليها هالة سابقاً تأتي آخراً.
 */
export async function listPriorityCatalog(env, { merchantId, limit = 500 } = {}) {
  const mid = requireMerchantId(merchantId);
  const db = requireDb(env);
  const cap = Math.min(Math.max(Number(limit) || 1, 1), 500);
  const { results } = await db
    .prepare(
      `SELECT sku, name, price, category, current_description, image_url, hala_published_at
         FROM store_products
        WHERE merchant_id = ?
        ORDER BY (hala_published_at IS NOT NULL) ASC,
                 (COALESCE(LENGTH(current_description), 0) = 0) DESC,
                 (COALESCE(LENGTH(current_description), 0) < 80) DESC,
                 synced_at DESC
        LIMIT ?`
    )
    .bind(mid, cap)
    .all();
  return results || [];
}

/**
 * منتجات يختارها التاجر بنفسه من شبكة «منتجاتي» — بديل ترتيب الأولوية حين
 * يقرّر هو أي المنتجات تُوصف.
 *
 * العزل شرط بنيوي لا تحسين: قائمة الـSKU **مدخل عميل**، فلو استُعلم بها بلا
 * `merchant_id` لأمكن لتاجر أن يولّد أوصافاً على منتجات متجر آخر ويقرأ
 * أسماءها وأسعارها بردّ الوظيفة. الشرط هنا يمنع ذلك عند المصدر، والترتيب
 * يتبع ما اختاره التاجر لا ما رتّبناه له.
 *
 * سقف ٥٠٠: نفس سقف المسار التلقائي — قائمة أطول تعني وظيفة تتجاوز حصة
 * الشهر بكثير، ولا فائدة من قبولها.
 */
export async function selectCatalogBySkus(env, { merchantId, skus } = {}) {
  const mid = requireMerchantId(merchantId);
  const db = requireDb(env);
  const wanted = [...new Set((Array.isArray(skus) ? skus : [])
    .map((s) => String(s ?? "").trim())
    .filter(Boolean))].slice(0, 500);
  if (!wanted.length) return [];

  const rows = [];
  // D1 يحدّ عدد المعاملات لكل استعلام — نقسّم القائمة لدفعات صغيرة.
  const CHUNK = 50;
  for (let i = 0; i < wanted.length; i += CHUNK) {
    const part = wanted.slice(i, i + CHUNK);
    const holes = part.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT sku, name, price, category, current_description, image_url, variants
           FROM store_products
          WHERE merchant_id = ? AND sku IN (${holes})`
      )
      .bind(mid, ...part)
      .all();
    rows.push(...(results || []));
  }

  // ترتيب التاجر كما اختاره، لا ترتيب قاعدة البيانات.
  const order = new Map(wanted.map((s, i) => [s, i]));
  return rows.sort((a, b) => (order.get(a.sku) ?? 0) - (order.get(b.sku) ?? 0));
}

/**
 * بعد نشر هالة وصفاً على سلة: الحالي = ما نُشر، والأصل يبقى كما هو.
 * لا يُنشئ صفاً: منتج غير مسحوب (مسار CSV اليدوي) يبقى بلا صف — لا نخترع
 * بيانات كتالوج من صف رفع يدوي.
 */
export async function markPublished(env, { merchantId, sku, description } = {}) {
  const mid = requireMerchantId(merchantId);
  const db = requireDb(env);
  const key = text(sku, 100);
  if (!key) return;
  await db
    .prepare(
      `UPDATE store_products
          SET current_description = ?, hala_published_at = datetime('now')
        WHERE merchant_id = ? AND sku = ?`
    )
    .bind(text(description, 20000), mid, key)
    .run();
}

/** بعد التراجع: الحالي يعود للأصل، وعلامة نشر هالة تُمسح. */
export async function markReverted(env, { merchantId, sku } = {}) {
  const mid = requireMerchantId(merchantId);
  const db = requireDb(env);
  const key = text(sku, 100);
  if (!key) return;
  await db
    .prepare(
      `UPDATE store_products
          SET current_description = original_description, hala_published_at = NULL
        WHERE merchant_id = ? AND sku = ?`
    )
    .bind(mid, key)
    .run();
}

/** هل سُحب كتالوج هذا التاجر مرة على الأقل؟ (migrations/0026) — لا يرمي أبداً. */
export async function getCatalogSyncState(env, { merchantId }) {
  if (!env?.DB || !merchantId) return { syncedAt: null };
  const row = await env.DB.prepare("SELECT catalog_synced_at AS t FROM merchants WHERE id = ?")
    .bind(merchantId)
    .first()
    .catch(() => null);
  return { syncedAt: row?.t || null };
}

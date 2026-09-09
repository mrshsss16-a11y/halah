// محوّل سلة — **HTTP خالص**: صفر D1، صفر تشفير، صفر منطق تخزين.
// Base: https://api.salla.dev/admin/v2/ with Authorization: Bearer <token>.
//
// المرحلة ٣ (ARCHITECTURE §٢) فكّت اقترانه بـ`core/db.js`: كان يقرأ توكن
// التاجر ويجدّده بنفسه. الآن **التوكن يُمرَّر إليه** — التخزين والتشفير وقفل
// التجديد (`refresh_lock`) كلها بـ`domain/salla.js`.
//
// توكن الوصول يعيش ١٤ يوماً وتوكن التجديد **يُستخدم مرة واحدة**: تجديدان
// متوازيان يُبطلان التفويض كاملاً (يفرضان إعادة تثبيت التطبيق) — لذلك
// `refreshSallaToken` هنا **لا يحرس نفسه**؛ حراسته مسؤولية domain/salla.js.

const API_BASE = "https://api.salla.dev/admin/v2";
const TOKEN_URL = "https://accounts.salla.sa/oauth2/token";

// SSRF: `path` يُبنى أحياناً من قيم خارجية (معرّف منتج من D1 أو من ويبهوك سلة).
// المضيف مثبَّت هنا لأن `API_BASE` ثابت، لكن التثبيت الصريح يمنع أي تمرير مستقبلي
// لمسار مطلق (`https://evil/...`) من تحويل الوجهة قبل لصق توكن التاجر.
const SALLA_ALLOWED_HOSTS = new Set(["api.salla.dev", "accounts.salla.sa"]);

/** fail closed: يرمي قبل بناء ترويسة Authorization — لا يُرسَل التوكن إطلاقاً. */
function assertSallaUrlAllowed(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    throw new Error("رابط سلة غير صالح — رُفض قبل إرسال أي بيانات اعتماد.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`مخطط غير مسموح (${parsed.protocol}) — رُفض قبل إرسال التوكن.`);
  }
  if (!SALLA_ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`مضيف غير مسموح (${parsed.hostname}) — رُفض قبل إرسال توكن التاجر.`);
  }
  return parsed.toString();
}

/**
 * تبادل توكن التجديد بتوكن جديد — طلب HTTP فقط، بلا قفل وبلا حفظ.
 * المستدعي الوحيد المسموح: `domain/salla.js` بعد الفوز بقفل التجديد.
 */
export async function refreshSallaToken({ refreshToken, clientId, clientSecret }) {
  const res = await fetch(assertSallaUrlAllowed(TOKEN_URL), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  if (!res.ok) {
    throw new Error(`salla token refresh failed: HTTP ${res.status}`);
  }
  return res.json();
}

/** نداء واحد على واجهة سلة بتوكن جاهز. لا يعرف من أين جاء التوكن. */
async function sallaFetch(token, path, opts = {}) {
  // التحقق أولاً — قبل حتى لمس التوكن.
  const url = assertSallaUrlAllowed(`${API_BASE}${path}`);
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(opts.headers || {})
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`salla API ${path}: HTTP ${res.status} ${body.slice(0, 200)}`);
    // مصنَّف للمستدعين: ٤٢٩ يحمل Retry-After (توثيق سلة doc-421125) حتى يوقف
    // النشر الجماعي التِك كاملاً بدل التخمين من نص الرسالة.
    err.status = res.status;
    const ra = Number(res.headers.get("Retry-After"));
    err.retryAfter = Number.isFinite(ra) && ra > 0 ? ra : null;
    err.rateLimitRemaining = res.headers.get("X-RateLimit-Remaining");
    throw err;
  }
  return res.json();
}

// ── واجهة المحوّل: كل دالة تأخذ **توكناً جاهزاً** ─────────────────────────────
//
// المرحلة ٦ حذفت كتلة الـshim التي كانت تستورد `getValidSallaToken` من
// `domain/salla.js` وتحفظ توقيع `(env, merchantId, …)`. الاستيراد ذاك كان
// الخرق الوحيد الباقي لقاعدة الاتجاه ق٢ (المحوّل لا يعرف المجال ولا D1).
// الآن: المستدعي (كله بـ`domain/*`) يجلب التوكن ويمرّره. صفر تغيير سلوكي —
// نفس المسارات ونفس المعاملات ونفس تصنيف الأخطاء.

export async function listProducts(token, page = 1) {
  // 60 is Salla's documented max per_page — cuts full-catalog sync requests
  // to a third versus the old default of 20 (docs/ROADMAP.md B3 design notes).
  return sallaFetch(token, `/products?page=${page}&per_page=60`);
}

export async function updateProduct(token, productId, fields) {
  return sallaFetch(token, `/products/${productId}`, {
    method: "PUT",
    body: JSON.stringify(fields)
  });
}

// PUT /products/sku/{sku} — updates by SKU directly, halving request count
// versus list-then-update-by-id for bulk jobs (B3). Salla's real limit is a
// 1 req/sec leak bucket across all plan tiers, not the advertised per-minute
// numbers — callers MUST space these out themselves (see cron/bulk_process.js).
export async function updateProductBySku(token, sku, fields) {
  return sallaFetch(token, `/products/sku/${encodeURIComponent(sku)}`, {
    method: "PUT",
    body: JSON.stringify(fields)
  });
}

// GET /store/info — يُستدعى مرة عقب app.store.authorize: حمولة الويبهوك نفسها
// لا تحمل اسم المتجر (access_token/refresh_token/expires/scope فقط)، ولذلك كان
// store_name فارغاً لكل تاجر بالقاعدة الحية والرأس يعرض عنواناً عاماً للجميع.
export async function getStoreInfo(token) {
  const res = await sallaFetch(token, "/store/info");
  const d = res?.data || {};
  return { name: d.name || null, domain: d.domain || null };
}

export async function listOrders(token, page = 1) {
  return sallaFetch(token, `/orders?page=${page}&per_page=10`);
}

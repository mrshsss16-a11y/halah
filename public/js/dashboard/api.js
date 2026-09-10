// public/js/dashboard/api.js — كل نداءات الشبكة للوحة التاجر بمكان واحد.
//
// لماذا ليس `apiPost` من /js/shared.js: apiPost يرمي استثناءً عند أي !res.ok أو
// ok:false برسالة عربية موحّدة. صفحة اللوحة تميّز حالات كثيرة بنص مختلف لكل
// حالة (خطأ خادم مقابل جسم بلا حقل error مقابل ردّ فارغ)، وتحويلها لـapiPost
// كان سيغيّر النص الذي يقرأه التاجر — والمرحلة ٥ تقسيم بلا تغيير سلوكي.
// فالمحافظة هنا على شكل الرد الخام: كل دالة ترجّع { res, data } بنفس أسلوب
// تحليل JSON الذي كان بموضع النداء الأصلي (بعضها يتساهل بـ{}، بعضها بـnull،
// وبعضها يرمي عمداً ليقع بـcatch الخارجي).

const JSON_HEADERS = { "Content-Type": "application/json" };

function postRaw(path, body) {
  return fetch(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body || {}) });
}

/** تحليل صارم: JSON غير صالح يرمي — يقع بـcatch الخارجي كما كان. */
async function postStrict(path, body) {
  const res = await postRaw(path, body);
  const data = await res.json();
  return { res, data };
}

/** تحليل متساهل: JSON غير صالح ⇒ القيمة الاحتياطية، والمستدعي يفحصها. */
async function postSoft(path, body, fallback) {
  const res = await postRaw(path, body);
  const data = await res.json().catch(() => fallback);
  return { res, data };
}

// ── الكتالوج ────────────────────────────────────────────────────────
export async function fetchCatalogList(offset) {
  const res = await fetch("/api/store/catalog/list?limit=24&offset=" + encodeURIComponent(offset));
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export function postCatalogSync() {
  return postSoft("/api/store/catalog/sync", {}, {});
}

// ── التوليد بالجملة ─────────────────────────────────────────────────
export function postBulkGenerateSelected(skus, tone) {
  return postSoft("/api/store/bulk/generate", { skus, tone }, null);
}

export function postBulkGenerateAll(tone) {
  return postStrict("/api/store/bulk/generate", { tone });
}

export function postBulkUpload(rows, tone) {
  return postStrict("/api/store/bulk/upload", { rows, tone });
}

export function postBulkStatus(jobId) {
  return postSoft("/api/store/bulk/status", { jobId }, null);
}

// ── وصف المنتج والنشر ───────────────────────────────────────────────
export function postCopy(payload) {
  return postSoft("/api/copy", payload, null);
}

export function postPublish(payload) {
  return postStrict("/api/store/publish", payload);
}

// ── طابور المراجعة ──────────────────────────────────────────────────
export function postReviewList(state, limit) {
  return postStrict("/api/store/review/list", { state, limit });
}

/** قرار المراجعة — المستدعي الأصلي كان يقرأ الجسم مباشرة بلا فحص res.ok. */
export async function postReviewDecide(payload) {
  const res = await postRaw("/api/store/review/decide", payload);
  return res.json();
}

// ── التغذية الراجعة ─────────────────────────────────────────────────
export function postFeedback(score, comment, context) {
  return postStrict("/api/store/feedback", { score, comment, context });
}

// ── المتجر والحصة ───────────────────────────────────────────────────
export function postStoreOverview() {
  return postSoft("/api/store/overview", {}, null);
}

export function postUsage() {
  return postStrict("/api/usage", {});
}

// ── المصادقة ────────────────────────────────────────────────────────
// هذان النداءان بلا ترويسة Content-Type بالأصل (بوابة CSRF تسمح لهما) —
// إضافتها هنا تغيير سلوكي غير مطلوب، فبقيا كما كانا حرفياً.
export async function postAuthMe() {
  const res = await fetch("/api/auth/me", { method: "POST" });
  const data = await res.json();
  return { res, data };
}

export function postLogout() {
  return fetch("/api/auth/logout", { method: "POST" });
}

export function postCompleteAccount(email, password) {
  return postRaw("/api/auth/complete_account", { email, password });
}

export function postSallaEmbedded(token) {
  return postStrict("/api/auth/salla_embedded", { token });
}

/** تطبيق التصنيف المقترح — تحليل متساهل: ردّ غير صالح ⇒ رسالة عامة. */
export function postCategory(body) {
  return postSoft("/api/store/category", body, null);
}

// Structured error logging — replaces raw `console.error(err)` (which spills
// stack traces that may embed request bodies — phone numbers, chat text —
// into Cloudflare's log stream).
//
// Every call site must pass storeId explicitly when known, and must never
// pass raw user text (messages, phone numbers, emails) in `internal` — only
// the error class/message and static context (endpoint, code). This file has
// no way to enforce that at the call site, so it's the one rule every future
// handler touching this module must follow (see docs/PARALLEL_TRACKS.md §أ.٤).
//
// Dual sink: console (always — visible via `wrangler tail` only; there is NO
// Observability tab for this project: Cloudflare Pages rejects the
// [observability] key outright, so wrangler.toml does NOT enable it — see the
// note at wrangler.toml:32) + D1 (queryable by /api/admin/errors).
// The D1 write is fire-and-forget: a logging failure must never break the
// response the caller is already returning to the merchant.

// ٣.١٠ — `internal` هنا ليس دائماً نصاً كتبه هذا المشروع: رسائل خطأ من Graph
// API (واتساب/إنستغرام) وغيرها من SDKs تُرجع أحياناً التوكن المرفوض داخل
// نص الخطأ نفسه، و`err.stack` الكامل قد يحمل ترويسة Authorization ضمن رسالة
// استثناء HTTP. هذا يُطبَّق قبل أي كتابة (console أو D1) على كل `internal`.
const TOKEN_PATTERNS = [
  // "Authorization: Bearer <token>" أو "Bearer <token>" وحدها.
  /Bearer\s+\S+/gi,
  // توكنات ميتا طويلة العمر تبدأ حرفياً بـ"EAA".
  /EAA[A-Za-z0-9]+/g,
  // access_token=... / token=... / secret=... بأي استعلام أو رسالة خطأ —
  // سلسلة ≥٣٢ حرفاً من [A-Za-z0-9_-] بعدها تُعامَل كسر مهما كان مصدرها.
  /((?:access_token|token|secret)=)[A-Za-z0-9_-]{32,}/gi
];

/**
 * ينقّي نص خطأ داخلي قبل الكتابة: يستبدل أي شيء يشبه توكناً بـ`[redacted]`،
 * ويقصّ قيمة متعددة الأسطر (`err.stack`) لأول ٣ أسطر — الأسطر التالية نادراً
 * ما تضيف تشخيصاً وتُطيل الصف بلا داعٍ.
 */
export function sanitizeInternal(internal) {
  if (internal === null || internal === undefined) return null;
  let s = String(internal);
  s = s.replace(TOKEN_PATTERNS[0], "Bearer [redacted]");
  s = s.replace(TOKEN_PATTERNS[1], "[redacted]");
  s = s.replace(TOKEN_PATTERNS[2], "$1[redacted]");
  const lines = s.split("\n");
  if (lines.length > 3) s = lines.slice(0, 3).join("\n");
  return s;
}

export function logError(context, { requestId, path, code, internal, storeId = null }) {
  const truncatedInternal = internal ? sanitizeInternal(internal).slice(0, 2000) : null;
  // error_log.request_id عمود NOT NULL (migrations/0015). ٣٤ استدعاءً خارج مسار HTTP تمرّر
  // requestId: null، فكان كل إدراج منها يفشل بـ«NOT NULL constraint failed» ويُبلع — لذلك لم
  // يظهر بالجدول سطر COPY_QUALITY واحد قط (كُشف بالسجل الحي 2026-09-11). معرّف داخلي بدل الضياع.
  const rid = requestId || `int-${crypto.randomUUID().slice(0, 12)}`;
  const entry = { requestId: rid, path, code, storeId, internal: truncatedInternal, ts: new Date().toISOString() };
  console.error("[hala-error]", JSON.stringify(entry));

  const db = context?.env?.DB;
  if (!db) return;

  // الملف نفسه يقول: فشل التسجيل يجب ألا يكسر الرد. لكن `prepare(...)` كان
  // يُستدعى خارج أي حماية، فأي عطل متزامن بالـbinding يرمي من داخل logError
  // ويُسقط المعالج الذي كان يحاول الإبلاغ عن خطأ أصلاً — أسوأ لحظة ممكنة.
  let write;
  try {
    write = db
      .prepare(
        `INSERT INTO error_log (request_id, store_id, code, path, internal) VALUES (?, ?, ?, ?, ?)`
      )
      .bind(rid, storeId, code, path, truncatedInternal)
      .run()
      .catch((e) => console.error("[hala-error-log-write-failed]", e?.message));
  } catch (e) {
    console.error("[hala-error-log-write-failed]", e?.message);
    return;
  }

  if (context?.waitUntil) {
    context.waitUntil(write);
  }
}

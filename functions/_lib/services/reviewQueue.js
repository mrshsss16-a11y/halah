// B7 — بوابة المراجعة البشرية: الطبقة الوحيدة اللي تلمس جدول review_queue.
//
// لماذا طبقة خدمة (services/، مقترحة بـM1) بدل استعلامات موزّعة على الـendpoints:
// شرط العزل (merchant_id) لازم يكون مفروضاً بمكان واحد لا يمكن نسيانه، تماماً
// مثل errorLog.js كوسيط وحيد لجدول error_log. أي استدعاء بلا merchantId يرمي
// خطأ فوراً (fail closed) — لا "تمرير برشاقة" بقيمة افتراضية.
//
// كل دالة هنا تأخذ merchantId وتضعه بشرط WHERE/INSERT بلا استثناء (المعيار أ.١).
// UPDATE يحمل merchant_id بالشرط حتى لو id فريد عالمياً: id مخمّن = تعديل صف
// تاجر ثانٍ لو اعتمدنا على الـid وحده.
import { ApiError } from "../core/respond.js";

export const REVIEW_KINDS = ["report", "social_reply", "image", "description"];
export const REVIEW_STATUSES = ["pending", "approved", "rejected"];

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
const MAX_PAYLOAD_CHARS = 20000;
const MAX_REASON_CHARS = 500;

/** رسالة عربية للمستخدم؛ التفاصيل التقنية تروح لسجل الأخطاء عبر respond.js. */
function invalid(message, internal) {
  return new ApiError(400, message, "REVIEW_INVALID", internal);
}

function requireMerchantId(merchantId) {
  if (typeof merchantId !== "string" || !merchantId.trim()) {
    throw invalid("المتجر غير محدد.", "reviewQueue: missing merchantId");
  }
  return merchantId.trim();
}

function requireDb(env) {
  if (!env?.DB) {
    throw new ApiError(503, "الخدمة غير متاحة حالياً.", "DB_UNAVAILABLE", "reviewQueue: DB binding missing");
  }
  return env.DB;
}

function requireId(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) {
    throw invalid("رقم العنصر غير صالح.", "reviewQueue: invalid id");
  }
  return n;
}

/** payload يُخزَّن نصاً — كائن يُسلسَل، نص يُقبل كما هو. */
function normalizePayload(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload ?? null);
  if (!text || text === "null" || !text.trim()) {
    throw invalid("المحتوى المطلوب مراجعته فارغ.", "reviewQueue: empty payload");
  }
  if (text.length > MAX_PAYLOAD_CHARS) {
    throw invalid("المحتوى المطلوب مراجعته كبير جداً.", `reviewQueue: payload ${text.length} chars`);
  }
  return text;
}

/**
 * يضيف مخرج AI للطابور بحالة pending.
 * لا يُرسَل شيء للعميل قبل approve — هذي الدالة هي كل ما يفعله المولِّد.
 */
export async function enqueue(env, { merchantId, kind, payload }) {
  const db = requireDb(env);
  const mid = requireMerchantId(merchantId);

  if (!REVIEW_KINDS.includes(kind)) {
    throw invalid("نوع المحتوى غير مدعوم.", `reviewQueue: unknown kind`);
  }
  const text = normalizePayload(payload);

  const row = await db
    .prepare(
      `INSERT INTO review_queue (merchant_id, kind, payload, status)
       VALUES (?, ?, ?, 'pending')
       RETURNING id, merchant_id, kind, status, created_at`
    )
    .bind(mid, kind, text)
    .first();

  return row;
}

/** المعلّق لمتجر واحد، الأقدم أولاً (يطابق idx_review_queue_pending). */
export async function listPending(env, { merchantId, limit = DEFAULT_LIMIT, kind = null } = {}) {
  const db = requireDb(env);
  const mid = requireMerchantId(merchantId);
  const cap = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  if (kind !== null && !REVIEW_KINDS.includes(kind)) {
    throw invalid("نوع المحتوى غير مدعوم.", "reviewQueue: unknown kind filter");
  }

  const { results } = kind
    ? await db
        .prepare(
          `SELECT id, merchant_id, kind, payload, status, created_at
             FROM review_queue
            WHERE merchant_id = ? AND status = 'pending' AND kind = ?
            ORDER BY created_at ASC, id ASC
            LIMIT ?`
        )
        .bind(mid, kind, cap)
        .all()
    : await db
        .prepare(
          `SELECT id, merchant_id, kind, payload, status, created_at
             FROM review_queue
            WHERE merchant_id = ? AND status = 'pending'
            ORDER BY created_at ASC, id ASC
            LIMIT ?`
        )
        .bind(mid, cap)
        .all();

  return results || [];
}

/**
 * تحويل حالة واحد: pending → approved/rejected فقط.
 * الشرط `status = 'pending'` يمنع إعادة اعتماد/قلب قرار سابق بصمت (سباق بين
 * مراجعَين، أو إعادة إرسال الطلب). صفر صفوف متأثرة = رفض صريح، لا نجاح كاذب.
 */
async function transition(env, { merchantId, id, reviewedBy, next, reason = null }) {
  const db = requireDb(env);
  const mid = requireMerchantId(merchantId);
  const rowId = requireId(id);

  if (typeof reviewedBy !== "string" || !reviewedBy.trim()) {
    throw invalid("المراجِع غير محدد.", "reviewQueue: missing reviewedBy");
  }
  if (reason !== null && String(reason).length > MAX_REASON_CHARS) {
    throw invalid("سبب الرفض طويل جداً.", "reviewQueue: reason too long");
  }

  const updated = await db
    .prepare(
      `UPDATE review_queue
          SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_note = ?
        WHERE id = ? AND merchant_id = ? AND status = 'pending'
        RETURNING id, merchant_id, kind, status, reviewed_by, reviewed_at, review_note`
    )
    .bind(next, reviewedBy.trim(), reason === null ? null : String(reason), rowId, mid)
    .first();

  if (!updated) {
    // إما الصف لمتجر ثانٍ، أو غير موجود، أو مُراجَع مسبقاً — نفس الرسالة
    // للثلاثة عمداً: لا نكشف وجود صفوف تاجر آخر عبر فرق الرسائل.
    throw new ApiError(
      404,
      "العنصر غير موجود أو تمت مراجعته مسبقاً.",
      "REVIEW_NOT_PENDING",
      `reviewQueue: no pending row for transition to ${next}`
    );
  }

  return updated;
}

export async function approve(env, { merchantId, id, reviewedBy }) {
  return transition(env, { merchantId, id, reviewedBy, next: "approved" });
}

export async function reject(env, { merchantId, id, reviewedBy, reason = null }) {
  return transition(env, { merchantId, id, reviewedBy, next: "rejected", reason });
}

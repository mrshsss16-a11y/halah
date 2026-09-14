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
import { DomainError } from "../core/errors.js";
import { REVIEW_LIST_LIMITS, clampLimit } from "../core/limits.js";
import { REVIEW_KINDS, MAX_REASON_CHARS, invalid, requireMerchantId, requireDb, requireId, normalizePayload }
  from "./reviewGuards.js";
import { sanitizeReviewFields } from "./reviewFields.js";
import { toReviewView } from "./reviewView.js";

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
export async function listPending(env, { merchantId, limit = REVIEW_LIST_LIMITS.default, kind = null } = {}) {
  const db = requireDb(env);
  const mid = requireMerchantId(merchantId);
  const cap = clampLimit(limit, REVIEW_LIST_LIMITS);

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

  // payload يُعاد مع الاعتماد لأن النشر يحتاجه فوراً (publishApproved.js).
  // قراءته بنفس العبارة الذرّية بدل SELECT ثانٍ يمنع سباقاً: بين UPDATE وSELECT
  // منفصلين قد يتغير الصف، فيُنشر محتوى غير الذي اعتُمد.
  const updated = await db
    .prepare(
      `UPDATE review_queue
          SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_note = ?
        WHERE id = ? AND merchant_id = ? AND status = 'pending'
        RETURNING id, merchant_id, kind, payload, status, reviewed_by, reviewed_at, review_note`
    )
    .bind(next, reviewedBy.trim(), reason === null ? null : String(reason), rowId, mid)
    .first();

  if (!updated) {
    // إما الصف لمتجر ثانٍ، أو غير موجود، أو مُراجَع مسبقاً — نفس الرسالة
    // للثلاثة عمداً: لا نكشف وجود صفوف تاجر آخر عبر فرق الرسائل.
    throw new DomainError(
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

/**
 * تسجيل نتيجة النشر بعد الاعتماد (migrations/0018).
 *
 * لا يلمس `status` إطلاقاً: الحالة قرار الإنسان، والنشر حدث لاحق قد يفشل لأسباب
 * خارجة عنه (نافذة Meta انتهت، توكن، حد معدل). فشل شبكة لا يجوز أن يمحو قراراً
 * بشرياً.
 *
 * الشرط `status = 'approved'` يمنع تسجيل نشر لصف مرفوض أو معلّق — لا يُنشر إلا
 * المعتمد، ولا يُسجَّل إلا عليه.
 */
export async function recordPublishResult(env, { merchantId, id, externalId = null, error = null }) {
  const db = requireDb(env);
  const mid = requireMerchantId(merchantId);
  const rowId = requireId(id);

  const row = await db
    .prepare(
      `UPDATE review_queue
          SET published_at = CASE WHEN ? IS NULL THEN datetime('now') ELSE published_at END,
              external_id = COALESCE(?, external_id),
              publish_error = ?
        WHERE id = ? AND merchant_id = ? AND status = 'approved'
        RETURNING id, merchant_id, published_at, external_id, publish_error`
    )
    .bind(
      error === null ? null : String(error).slice(0, 500),
      externalId === null ? null : String(externalId),
      error === null ? null : String(error).slice(0, 500),
      rowId,
      mid
    )
    .first();

  if (!row) {
    throw new DomainError(
      404,
      "العنصر غير موجود أو غير معتمد.",
      "REVIEW_NOT_APPROVED",
      "reviewQueue: no approved row to record publish result on"
    );
  }
  return row;
}

// ── المرحلة ٢ (docs/COMPLETION_PATH.md) — المراجعة الجماعية والنشر المتأخر ──

const MAX_BATCH_IDS = 100;

/**
 * اعتماد جماعي: حلقة فوق transition (لا SQL جديد) — كل صف يمر بنفس شرط
 * `status = 'pending' AND merchant_id = ?`. فشل صف (مُراجَع مسبقاً، أو لمتجر
 * ثانٍ) لا يوقف الباقي ولا يُخفى: يُعاد بقائمة failed مع سببه.
 */
export async function approveMany(env, { merchantId, ids, reviewedBy }) {
  const list = Array.isArray(ids) ? ids.slice(0, MAX_BATCH_IDS) : [];
  if (!list.length) throw invalid("لم تحدد أي عنصر.", "reviewQueue.approveMany: empty ids");
  const approved = [];
  const failed = [];
  for (const id of list) {
    try {
      const row = await transition(env, { merchantId, id, reviewedBy, next: "approved" });
      approved.push(row);
    } catch (err) {
      failed.push({ id, error: err?.userMessage || err?.message || "تعذّر الاعتماد." });
    }
  }
  return { approved, failed };
}

export async function rejectMany(env, { merchantId, ids, reviewedBy, reason = null }) {
  const list = Array.isArray(ids) ? ids.slice(0, MAX_BATCH_IDS) : [];
  if (!list.length) throw invalid("لم تحدد أي عنصر.", "reviewQueue.rejectMany: empty ids");
  const rejected = [];
  const failed = [];
  for (const id of list) {
    try {
      const row = await transition(env, { merchantId, id, reviewedBy, next: "rejected", reason });
      rejected.push(row);
    } catch (err) {
      failed.push({ id, error: err?.userMessage || err?.message || "تعذّر الرفض." });
    }
  }
  return { rejected, failed };
}

/**
 * تحرير سطري قبل الاعتماد: يُدمج `patch` فوق الحمولة الحالية — مشروط
 * `status = 'pending'` (ما اعتُمد أو رُفض لا يُعدَّل بصمت بعد القرار).
 * القراءة والكتابة بعبارتين: الدمج يحتاج المحتوى الحالي، ثم الكتابة بشرط
 * pending — لو تغيّرت الحالة بينهما تفشل الكتابة صراحة (٤٠٤)، لا نجاح كاذب.
 */
export async function updatePayload(env, { merchantId, id, patch }) {
  const db = requireDb(env);
  const mid = requireMerchantId(merchantId);
  const rowId = requireId(id);
  const patchIsFn = typeof patch === "function";
  if (!patchIsFn && (!patch || typeof patch !== "object" || Array.isArray(patch))) {
    throw invalid("التعديل غير صالح.", "reviewQueue.updatePayload: patch not an object");
  }

  const current = await db
    .prepare(`SELECT payload FROM review_queue WHERE id = ? AND merchant_id = ? AND status = 'pending'`)
    .bind(rowId, mid)
    .first();
  if (!current) {
    throw new DomainError(404, "العنصر غير موجود أو تمت مراجعته مسبقاً.", "REVIEW_NOT_PENDING", "reviewQueue.updatePayload: no pending row");
  }

  let base;
  try {
    base = JSON.parse(current.payload);
  } catch {
    throw invalid("محتوى العنصر غير قابل للتعديل.", "reviewQueue.updatePayload: payload not JSON");
  }
  if (!base || typeof base !== "object" || Array.isArray(base)) {
    throw invalid("محتوى العنصر غير قابل للتعديل.", "reviewQueue.updatePayload: payload not an object");
  }

  const effectivePatch = patchIsFn ? patch(base) : patch;
  if (!effectivePatch || typeof effectivePatch !== "object" || Array.isArray(effectivePatch)) {
    throw invalid("التعديل غير صالح.", "reviewQueue.updatePayload: computed patch not an object");
  }
  const merged = normalizePayload({ ...base, ...effectivePatch, editedAt: new Date().toISOString() });
  const updated = await db
    .prepare(
      `UPDATE review_queue SET payload = ?
        WHERE id = ? AND merchant_id = ? AND status = 'pending'
        RETURNING id, merchant_id, kind, payload, status, created_at`
    )
    .bind(merged, rowId, mid)
    .first();
  if (!updated) {
    throw new DomainError(404, "العنصر غير موجود أو تمت مراجعته مسبقاً.", "REVIEW_NOT_PENDING", "reviewQueue.updatePayload: lost race");
  }
  return updated;
}

/**
 * تحرير حقول المراجعة (وصف/نبذة/نقاط/أسئلة/مواصفات/سيو/استبعاد) بشكل جزئي —
 * يغلّف sanitizeReviewFields + updatePayload حتى يبقى api/decide.js تحت سقف
 * ٨٠ سطراً (docs/ARCHITECTURE §٤). يرمي REVIEW_INVALID لو لم ينتج تعديل صالح
 * (كل الحقول فارغة أو غير معروفة) بدل تحديث بلا أثر.
 */
export async function applyReviewFieldsUpdate(env, { merchantId, id, fields }) {
  const row = await updatePayload(env, {
    merchantId,
    id,
    patch: (base) => {
      const patch = sanitizeReviewFields(fields, base);
      if (Object.keys(patch).length === 0) {
        throw invalid("لا تعديل صالح.", "reviewQueue.applyReviewFieldsUpdate: empty patch after sanitize");
      }
      return patch;
    }
  });
  return toReviewView(row);
}

/** عدّادات صادقة لشاشة المراجعة: معلّق · معتمد بانتظار النشر · نُشر · فشل نشره · مرفوض. */
export async function countByState(env, { merchantId, kind }) {
  const db = requireDb(env);
  const mid = requireMerchantId(merchantId);
  if (!REVIEW_KINDS.includes(kind)) throw invalid("نوع المحتوى غير مدعوم.", "reviewQueue.countByState: unknown kind");
  const row = await db
    .prepare(
      `SELECT
         SUM(status = 'pending') AS pending,
         SUM(status = 'approved' AND published_at IS NULL AND publish_error IS NULL) AS awaiting_publish,
         SUM(status = 'approved' AND published_at IS NOT NULL) AS published,
         SUM(status = 'approved' AND published_at IS NULL AND publish_error IS NOT NULL) AS publish_failed,
         SUM(status = 'rejected') AS rejected
       FROM review_queue WHERE merchant_id = ? AND kind = ?`
    )
    .bind(mid, kind)
    .first();
  return {
    pending: Number(row?.pending || 0),
    awaitingPublish: Number(row?.awaiting_publish || 0),
    published: Number(row?.published || 0),
    publishFailed: Number(row?.publish_failed || 0),
    rejected: Number(row?.rejected || 0)
  };
}

const STATE_WHERE = {
  awaiting_publish: "status = 'approved' AND published_at IS NULL AND publish_error IS NULL",
  published: "status = 'approved' AND published_at IS NOT NULL",
  publish_failed: "status = 'approved' AND published_at IS NULL AND publish_error IS NOT NULL",
  rejected: "status = 'rejected'"
};

/** صفوف بحالة نشر معيّنة لمتجر واحد — لشاشة المراجعة (published/failed/rejected). */
export async function listByState(env, { merchantId, kind, state, limit = REVIEW_LIST_LIMITS.default }) {
  const db = requireDb(env);
  const mid = requireMerchantId(merchantId);
  const cap = clampLimit(limit, REVIEW_LIST_LIMITS);
  if (!REVIEW_KINDS.includes(kind)) throw invalid("نوع المحتوى غير مدعوم.", "reviewQueue.listByState: unknown kind");
  const where = STATE_WHERE[state];
  if (!where) throw invalid("الحالة غير مدعومة.", "reviewQueue.listByState: unknown state");
  // tenant-audit-ok: الشرط `merchant_id = ?` ثابت بالنص؛ `where` أحد أربعة نصوص ثابتة بـSTATE_WHERE، لا مدخل عميل.
  const { results } = await db
    .prepare(
      `SELECT id, merchant_id, kind, payload, status, reviewed_at, published_at, publish_error, review_note
         FROM review_queue WHERE merchant_id = ? AND kind = ? AND ${where}
        ORDER BY COALESCE(reviewed_at, created_at) DESC, id DESC LIMIT ?`
    )
    .bind(mid, kind, cap)
    .all();
  return results || [];
}

/**
 * إعادة محاولة نشر صف معتمد فشل نشره: يمسح publish_error فقط. الحالة لا تُمس
 * (القرار البشري قائم)، والـcron يلتقطه بالتِك التالي.
 */
export async function retryPublish(env, { merchantId, id }) {
  const db = requireDb(env);
  const mid = requireMerchantId(merchantId);
  const rowId = requireId(id);
  const row = await db
    .prepare(
      `UPDATE review_queue SET publish_error = NULL
        WHERE id = ? AND merchant_id = ? AND status = 'approved' AND published_at IS NULL
        RETURNING id, merchant_id, status`
    )
    .bind(rowId, mid)
    .first();
  if (!row) throw new DomainError(404, "العنصر غير موجود أو نُشر فعلاً.", "REVIEW_NOT_APPROVED", "reviewQueue.retryPublish: no row");
  return row;
}

/**
 * للـcron فقط: أي متجر عنده أوصاف معتمدة لم تُنشر؟ يُعاد **متجر واحد** لكل تِك
 * (الأقدم اعتماداً) — حد سلة ١ طلب/ثانية **لكل متجر**، فتقييد التِك بمتجر واحد
 * يجعل الفاصل الثابت فاصلاً حقيقياً لذلك المتجر، لا فاصلاً عاماً ينكسر مع
 * متجرين نشطين (المخاطرة ١ بـdocs/PLAN_BULK_SEO.md).
 */
export async function claimNextPublishMerchant(env, { kind = "description" } = {}) {
  const db = requireDb(env);
  // tenant-audit-ok: استعلام cron عابر للمتاجر بالتصميم — يختار متجراً واحداً ثم كل ما بعده معزول به.
  const row = await db
    .prepare(
      `SELECT merchant_id FROM review_queue
        WHERE kind = ? AND status = 'approved' AND published_at IS NULL AND publish_error IS NULL
        ORDER BY reviewed_at ASC, id ASC LIMIT 1`
    )
    .bind(kind)
    .first();
  return row?.merchant_id || null;
}

/** المعتمَد غير المنشور لمتجر واحد، الأقدم اعتماداً أولاً (يطابق idx_review_queue_unpublished). */
export async function listApprovedUnpublished(env, { merchantId, kind = "description", limit = REVIEW_LIST_LIMITS.default }) {
  const db = requireDb(env);
  const mid = requireMerchantId(merchantId);
  const cap = clampLimit(limit, REVIEW_LIST_LIMITS);
  const { results } = await db
    .prepare(
      `SELECT id, merchant_id, kind, payload, status, reviewed_by, reviewed_at
         FROM review_queue
        WHERE merchant_id = ? AND kind = ? AND status = 'approved' AND published_at IS NULL AND publish_error IS NULL
        ORDER BY reviewed_at ASC, id ASC LIMIT ?`
    )
    .bind(mid, kind, cap)
    .all();
  return results || [];
}

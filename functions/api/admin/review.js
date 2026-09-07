// POST /api/admin/review — بوابة المراجعة البشرية (B7).
// body: { action: "list" | "approve" | "reject", merchantId, id?, kind?, limit?, reason? }
//
// المبدأ: الذكاء الاصطناعي يقترح، والإنسان يقرر. هذا الـendpoint هو يد الإنسان.
// خلف requireAdmin (نمط admin/errors.js) — لكن **بخلاف** بقية ملفات الأدمن هنا،
// هذا الملف ليس عابراً للمتاجر: كل عملية تلزم merchantId صريحاً ويُمرَّر لطبقة
// services/reviewQueue.js اللي تفرضه بكل استعلام. لذلك هو غير مُدرَج بقائمة
// ADMIN_CROSS_TENANT_FILES في scripts/audit-isolation.mjs — لا يحتاج إعفاء.
//
// لا استعلام D1 مباشر هنا إطلاقاً: الوسيط الوحيد لجدول review_queue هو الخدمة،
// حتى يبقى شرط العزل بمكان واحد لا يمكن نسيانه بنسخة/لصق مستقبلية.
import { withApi, ApiError } from "../../_lib/core/respond.js";
import { requireAdmin } from "../../_lib/core/session.js";
import { listPending, approve, reject } from "../../_lib/services/reviewQueue.js";
import { publishApproved } from "../../_lib/services/publishApproved.js";

async function reviewHandler(body, env, request) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };

  const merchantId = typeof body.merchantId === "string" ? body.merchantId.trim() : "";
  if (!merchantId) {
    throw new ApiError(400, "المتجر غير محدد.", "REVIEW_INVALID", "admin/review: missing merchantId");
  }

  const action = String(body.action || "list");

  if (action === "list") {
    const rows = await listPending(env, {
      merchantId,
      limit: body.limit,
      kind: body.kind ?? null
    });
    return { ok: true, rows };
  }

  if (action === "approve") {
    // reviewed_by = إيميل الأدمن من الجلسة، لا قيمة يرسلها العميل (§7: لا تثق
    // بهوية يرسلها العميل). سجل المراجعة لازم يعكس من قرر فعلاً.
    const row = await approve(env, { merchantId, id: body.id, reviewedBy: admin.email });

    // النشر الفعلي — الطبقة الوحيدة المسموح لها الإرسال لمنصة خارجية.
    // نُنادى هنا مباشرة (لا waitUntil) عمداً: المراجع لازم يشوف نتيجة النشر
    // بنفس الاستجابة، لأن نافذة إنستغرام قد تكون انتهت وقتها ويحتاج يعرف فوراً.
    const publish = await publishApproved(env, row);

    // فشل النشر لا يُبطل الاعتماد — القرار البشري سُجِّل، والخطأ مسجّل على الصف
    // ليُعاد يدوياً. ok تعكس الاعتماد، publish تعكس الإرسال.
    return { ok: true, row, publish };
  }

  if (action === "reject") {
    const row = await reject(env, {
      merchantId,
      id: body.id,
      reviewedBy: admin.email,
      reason: body.reason ? String(body.reason) : null
    });
    return { ok: true, row };
  }

  throw new ApiError(400, "الإجراء غير مدعوم.", "REVIEW_INVALID", "admin/review: unknown action");
}

export const onRequestPost = withApi(reviewHandler);

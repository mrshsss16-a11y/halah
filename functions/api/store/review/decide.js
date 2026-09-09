// POST /api/store/review/decide — يد التاجر على بوابة المراجعة (المرحلة ٢).
//
// body.action:
//   approve      { ids: [..] }            اعتماد المحدد → يُنشر بالـcron (متجر/تِك، ≥١.١ث)
//   approve_all  {}                        اعتماد كل المعلّق (حتى ١٠٠ بالطلب)
//   reject       { ids: [..], reason? }
//   update       { id, description }       تحرير سطري قبل الاعتماد (pending فقط)
//   retry        { id }                    إعادة نشر صف معتمد فشل نشره
//   revert       { sku }                   إرجاع وصف المنتج الأصلي على سلة (التراجع)
//
// لماذا لا يُنشر هنا فور الاعتماد: حد سلة ١ طلب/ثانية لكل متجر، وتجاوزه يقطع
// اتصال المتجر كاملاً. اعتماد ٥٠ عنصراً بضغطة = ٥٠ كتابة — لا تُرسل من طلب
// HTTP واحد. الاعتماد قرار فوري، والنشر تصريف مجدول، والشاشة تعرض الفرق بصدق
// ("معتمد بانتظار النشر" ≠ "نُشر").
//
// `revert` هو الاستثناء الوحيد الذي يكتب على سلة مباشرة: كتابة واحدة بطلب واحد،
// مقيّدة بحد معدل ١٠/دقيقة/IP — أقل بكثير من حد سلة.
import { withApi, ApiError } from "../../../_lib/core/respond.js";
import { requireCompletedAccount } from "../../../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../../../_lib/core/rateLimit.js";
import { updateProductBySku } from "../../../_lib/integrations/salla.js";
import { getCatalogItem, markReverted } from "../../../_lib/services/catalog.js";
import {
  listPending,
  approveMany,
  rejectMany,
  updatePayload,
  retryPublish,
  countByState
} from "../../../_lib/services/reviewQueue.js";

const MAX_IDS = 100;

function idList(raw) {
  const arr = Array.isArray(raw) ? raw : raw !== undefined && raw !== null ? [raw] : [];
  const ids = arr.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) throw new ApiError(400, "لم تحدد أي عنصر.", "REVIEW_INVALID", "decide: empty ids");
  return [...new Set(ids)].slice(0, MAX_IDS);
}

async function decideHandler(body, env, request) {
  const merchantId = await requireCompletedAccount(request, env, body.storeId);
  // reviewed_by من الجلسة لا من الجسم (§7: لا تثق بهوية يرسلها العميل).
  const reviewedBy = `merchant:${merchantId}`;
  const action = String(body.action || "");

  if (action === "approve") {
    const r = await approveMany(env, { merchantId, ids: idList(body.ids), reviewedBy });
    return { ok: true, approved: r.approved.length, failed: r.failed, counts: await countByState(env, { merchantId, kind: "description" }) };
  }

  if (action === "approve_all") {
    const pending = await listPending(env, { merchantId, kind: "description", limit: MAX_IDS });
    if (!pending.length) return { ok: true, approved: 0, failed: [], counts: await countByState(env, { merchantId, kind: "description" }) };
    const r = await approveMany(env, { merchantId, ids: pending.map((p) => p.id), reviewedBy });
    const counts = await countByState(env, { merchantId, kind: "description" });
    return { ok: true, approved: r.approved.length, failed: r.failed, remainingPending: counts.pending, counts };
  }

  if (action === "reject") {
    const reason = body.reason ? String(body.reason).slice(0, 500) : null;
    const r = await rejectMany(env, { merchantId, ids: idList(body.ids), reviewedBy, reason });
    return { ok: true, rejected: r.rejected.length, failed: r.failed, counts: await countByState(env, { merchantId, kind: "description" }) };
  }

  if (action === "update") {
    const description = String(body.description || "").trim().slice(0, 5000);
    if (!description) throw new ApiError(400, "الوصف فارغ.", "REVIEW_INVALID", "decide.update: empty description");
    const row = await updatePayload(env, { merchantId, id: body.id, patch: { description } });
    return { ok: true, id: row.id };
  }

  if (action === "retry") {
    const row = await retryPublish(env, { merchantId, id: body.id });
    return { ok: true, id: row.id, message: "سيُعاد النشر خلال دقائق." };
  }

  if (action === "revert") {
    const rl = await checkRateLimit(env, clientIp(request), "review_revert", 10, 60);
    if (!rl.allowed) {
      return { ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" };
    }
    const sku = String(body.sku || "").trim().slice(0, 100);
    if (!sku) throw new ApiError(400, "رمز المنتج (SKU) غير محدد.", "REVIEW_INVALID", "decide.revert: missing sku");
    const item = await getCatalogItem(env, { merchantId, sku });
    if (!item) {
      return { ok: false, error: "هذا المنتج غير مسحوب من سلة — التراجع متاح فقط للمنتجات المسحوبة.", code: "NOT_IN_CATALOG" };
    }
    if (!item.hala_published_at) {
      return { ok: false, error: "ما نشرت هالة وصفاً على هذا المنتج — لا شيء نتراجع عنه.", code: "NOTHING_TO_REVERT" };
    }
    // الأصل قد يكون فارغاً فعلاً (منتج بلا وصف قبل هالة) — نُرجعه فارغاً بصدق، لا نخترع نصاً.
    const original = item.original_description || "";
    await updateProductBySku(env, merchantId, sku, { description: original });
    await markReverted(env, { merchantId, sku });
    const seoNote = "عنوان ووصف البحث اللذان أضافتهما هالة يبقيان — عدّلهما من لوحة سلة إن أردت.";
    return {
      ok: true,
      sku,
      restoredLength: original.length,
      message: (original ? "رجّعنا الوصف الأصلي؛ " : "رجّعنا المنتج بلا وصف كما كان؛ ") + seoNote
    };
  }

  throw new ApiError(400, "الإجراء غير مدعوم.", "REVIEW_INVALID", "decide: unknown action");
}

export const onRequestPost = withApi(decideHandler);

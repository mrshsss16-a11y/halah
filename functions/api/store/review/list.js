// POST /api/store/review/list — body: { storeId?, state?, limit? }
// شاشة المراجعة الجماعية للتاجر (المرحلة ٢، docs/COMPLETION_PATH.md).
//
// state: pending (افتراضي) · awaiting_publish · published · publish_failed · rejected.
// كل استعلام يمر بـservices/reviewQueue.js (الوسيط الوحيد لجدول review_queue)
// بـmerchantId من الجلسة — لا من الجسم. الحمولة تُعاد مفكوكة (JSON) حتى تعرض
// الشاشة "الحالي ← المقترح" بلا تفكيك بالمتصفح.
import { withApi } from "../../../_lib/core/respond.js";
import { requireCompletedAccount } from "../../../_lib/core/session.js";
import { listPending, listByState, countByState } from "../../../_lib/domain/review.js";
import { toReviewView as toView } from "../../../_lib/domain/reviewView.js";

const STATES = new Set(["pending", "awaiting_publish", "published", "publish_failed", "rejected"]);

async function reviewListHandler(body, env, request) {
  const merchantId = await requireCompletedAccount(request, env, body.storeId);
  const state = STATES.has(body.state) ? body.state : "pending";
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100);

  const rows =
    state === "pending"
      ? await listPending(env, { merchantId, kind: "description", limit })
      : await listByState(env, { merchantId, kind: "description", state, limit });

  const counts = await countByState(env, { merchantId, kind: "description" });

  return { ok: true, state, rows: rows.map(toView), counts };
}

export const onRequestPost = withApi(reviewListHandler);

// POST /api/store/overview — body: { storeId }
// المرحلة ٤: تنسيق فقط — التجميع وتدهور الأقسام بـ`domain/storeOverview.js`.
import { withApi } from "../../_lib/core/respond.js";
import { buildStoreOverview } from "../../_lib/domain/storeOverview.js";
import { resolveStoreId } from "../../_lib/core/session.js";
import { logError } from "../../_lib/core/errorLog.js";

async function overviewHandler(body, env, request, requestId) {
  // store-gate-ok: نظرة عامة للقراءة — يشوفها التاجر قبل إكمال الحساب بالتصميم (requireCompletedAccount docstring)
  const merchantId = await resolveStoreId(request, env, body.storeId);

  // نص المزوّد/D1 الخام لا يصل التاجر: التفصيل للسجل تحت نفس الـrequestId الذي
  // يحمله الرد أصلاً، والرسالة العربية تأتي من المجال.
  return buildStoreOverview(env, merchantId, (code, err) => {
    logError({ env }, {
      requestId,
      path: "store/overview",
      code,
      storeId: merchantId,
      internal: String((err && err.message) || err).slice(0, 300)
    });
    return { code, requestId };
  });
}

export const onRequestPost = withApi(overviewHandler);

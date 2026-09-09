// POST /api/admin/launch — لوحة متابعة الإطلاق المحدود (المرحلة ٤، 4.3).
//
// تجيب أسئلة "هل الإطلاق يمشي؟" بأرقام حقيقية من D1 فقط — صفر أرقام مخترعة:
// متاجر نشطة ٧ أيام · محادثات واتساب/ودجت ٧ أيام · أوصاف مولَّدة/منشورة ٧ أيام ·
// حجوزات ٧ أيام · أخطاء ٢٤ ساعة (بأكثر ٥ أكواد) · طابور المراجعة · آخر تغذية راجعة.
// عابر للمتاجر بالتصميم — خلف requireAdmin + سطر تدقيق، مُدرَج بإعفاء audit-isolation.
import { withApi } from "../../_lib/core/respond.js";
import { requireAdmin } from "../../_lib/core/session.js";
import { recordAdminAction } from "../../_lib/core/auditLog.js";
import { launchStats, listMerchantFeedback, listMerchantActivity } from "../../_lib/domain/analytics.js";

async function launchHandler(body, env, request, requestId, context) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };
  recordAdminAction(context, { admin, action: "launch_monitor", path: new URL(request.url).pathname, targetMerchantId: null, requestId });

  const [stats, feedback, activity] = await Promise.all([
    launchStats(env),
    listMerchantFeedback(env, 30),
    listMerchantActivity(env, 50)
  ]);
  return { ok: true, stats, feedback, activity, generatedAt: new Date().toISOString() };
}

export const onRequestPost = withApi(launchHandler);

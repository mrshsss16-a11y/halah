// POST /api/store/status — حال ربط متجر **الجلسة الحالية** فقط (سلة/ترنديول، واسم المتجر).
//
// تدقيق الأمن 2026-09-13 (البند ١، عالي): كانت تقبل `storeId` أو `sallaMerchantId` من جسم الطلب
// بلا جلسة وترجع المعرّف الداخلي `m_…` لمتجر ثبّت هالة من سلة ولم يُكمل تسجيله. ذلك المعرّف هو
// الاعتماد الوحيد لتلك المتاجر بـresolveStoreId، فمجهول يعرف رقم متجر بسلة كان يقرأ منتجاته
// وأسعاره ومخزونه (/api/store/overview) ويكتب ملاحظات باسمه. لا واجهة تستدعيها بلا جلسة
// (التضمين داخل سلة يُنشئ جلسته عبر /api/auth/salla-embedded)، فالمجهول يُرد بـ{linked:false} فقط.
import { withApi } from "../../_lib/core/respond.js";
import { getMerchant } from "../../_lib/core/identity.js";
import { getPlatformConnection } from "../../_lib/domain/platforms.js";
import { getTokens } from "../../_lib/domain/salla.js";
import { getSessionMerchantId } from "../../_lib/core/session.js";

async function statusHandler(_body, env, request) {
  const sessionMerchantId = await getSessionMerchantId(request, env);
  const merchant = sessionMerchantId ? await getMerchant(env, sessionMerchantId) : null;
  if (!merchant) return { linked: false };

  const sallaTokens = await getTokens(env, merchant.id, "salla");
  const trendyol = await getPlatformConnection(env, merchant.id, "trendyol");

  return {
    linked: Boolean(sallaTokens || trendyol),
    storeId: merchant.id,
    storeName: merchant.store_name,
    salla: Boolean(sallaTokens),
    trendyol: Boolean(trendyol)
  };
}

export const onRequestPost = withApi(statusHandler);

// POST /api/store/logo
// body: { storeId, logoDataUrl? } — if logoDataUrl present, saves it; always
// returns the current saved logo (so a save-then-load round trip is one call).
import { withApi } from "../../_lib/core/respond.js";
import { getStoreLogo, saveStoreLogo } from "../../_lib/core/db.js";
import { resolveStoreId, requireCompletedAccount } from "../../_lib/core/session.js";

const MAX_LOGO_BYTES = 500_000; // data URL length cap — small watermark, not a full asset

async function logoHandler(body, env, request) {
  // N5 — التعليق القديم قال "بلا كتابة" بينما الدالة تحفظ فعلاً: أي معرّف m_
  // مسرّب كان يكفي لاستبدال شعار متجر (يظهر على صور منتجاته). الكتابة الآن
  // خلف حساب مكتمل، والقراءة تبقى على نفس البوابة القديمة.
  const incoming = (body.logoDataUrl || "").toString();
  const merchantId = incoming
    ? await requireCompletedAccount(request, env, body.storeId)
    // store-gate-ok: قراءة الشعار فقط لودجت المتجر — بلا كتابة ولا AI
    : await resolveStoreId(request, env, body.storeId);

  if (incoming) {
    if (!/^data:image\/(png|webp|jpeg);base64,/.test(incoming)) {
      return { ok: false, error: "صيغة الشعار غير مدعومة (PNG/WEBP/JPEG فقط)." };
    }
    if (incoming.length > MAX_LOGO_BYTES) {
      return { ok: false, error: "حجم الشعار كبير — استخدم صورة أصغر." };
    }
    await saveStoreLogo(env, merchantId, incoming);
  }

  const logoDataUrl = await getStoreLogo(env, merchantId);
  return { ok: true, logoDataUrl };
}

export const onRequestPost = withApi(logoHandler);

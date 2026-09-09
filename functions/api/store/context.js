// POST /api/store/context
// body: { storeId, dialect?, instructions? } → persist marketer settings.
// This is what makes communication.html's "حفظ وتطبيق التعليمات" real:
// chat.js reads the saved context from D1 on every reply.
import { withApi } from "../../_lib/core/respond.js";
import { saveMarketingContext, getMarketingContext } from "../../_lib/domain/persona.js";
import { resolveStoreId, requireCompletedAccount } from "../../_lib/core/session.js";

async function contextHandler(body, env, request) {
  // N4 — الكتابة والقراءة كانتا على نفس البوابة. `instructions` تُحقن بنص نظام
  // البوت لكل رد لاحق، فأي معرّف m_ مسرّب كان يكفي لزرع تعليمات دائمة بلا حساب.
  // القاعدة الآن: الكتابة تتطلب حساباً مكتملاً، والقراءة تبقى كما كانت.
  const isWrite = body.dialect !== undefined || body.instructions !== undefined;

  const merchantId = isWrite
    ? await requireCompletedAccount(request, env, body.storeId)
    // store-gate-ok: قراءة فقط — سياق المتجر للودجت، معزول بالجلسة أو بمعرّف m_ غير قابل للتخمين
    : await resolveStoreId(request, env, body.storeId);

  if (isWrite) {
    const dialect = ["saudi_najdi", "saudi_hijazi", "fusha_friendly"].includes(body.dialect)
      ? body.dialect
      : null;
    await saveMarketingContext(env, merchantId, {
      dialect,
      instructions: body.instructions !== undefined ? String(body.instructions).slice(0, 2000) : null
    });
  }

  const saved = await getMarketingContext(env, merchantId);
  return {
    ok: true,
    dialect: (saved && saved.dialect) || "saudi_najdi",
    instructions: (saved && saved.instructions) || ""
  };
}

export const onRequestPost = withApi(contextHandler);

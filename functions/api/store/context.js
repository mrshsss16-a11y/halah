// POST /api/store/context
// body: { storeId, dialect?, instructions? } → persist marketer settings.
// This is what makes communication.html's "حفظ وتطبيق التعليمات" real:
// chat.js reads the saved context from D1 on every reply.
import { withApi } from "../../_lib/respond.js";
import { saveMarketingContext, getMarketingContext } from "../../_lib/db.js";

async function contextHandler(body, env) {
  const merchantId = (body.storeId || "default-store").toString().slice(0, 40);

  if (body.dialect !== undefined || body.instructions !== undefined) {
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

// GET / POST /api/store/digest
// Generates the Weekly Merchant Rescue Card (WhatsApp shareable card + metrics)
import { withApi } from "../../_lib/core/respond.js";
import { getWeeklyStoreStats, getMerchant } from "../../_lib/core/db.js";
import { resolveStoreId } from "../../_lib/core/session.js";

async function digestHandler(body, env, request) {
  const storeId = await resolveStoreId(request, env, body.storeId);
  const merchant = env.DB ? await getMerchant(env, storeId).catch(() => null) : null;
  const storeName = (merchant && merchant.store_name) || storeId || "متجرك";

  const stats = await getWeeklyStoreStats(env, storeId);

  const formattedMessage = `📊 *بطاقة نجاة الأسبوع — متجر ${storeName}*

هالة أنقذت متجرك هذا الأسبوع وألغت الخسائر التالية:
✅ *${stats.totalReplies}* رد آلي خاطف على المحادثات
🛒 *${stats.recoveredCarts}* سلات متروكة ومتابعات ناجحة
⭐ *${stats.qaAnswered}* إجابات أوتوماتيكية على استفسارات العملاء

💰 *المبلغ التقديري الموفر لمتجرك:* ~${stats.estimatedSavingsSar} ريال سعودي!

---
🚀 مفعّل مجاناً بواسطة *منصة هالة (Hala AI OS)*
https://hala-ai-os.pages.dev`;

  return {
    ok: true,
    storeId,
    storeName,
    stats,
    whatsappShareText: formattedMessage,
    shareCard: {
      title: `بطاقة نجاة الأسبوع — ${storeName}`,
      savedSar: stats.estimatedSavingsSar,
      replies: stats.totalReplies,
      recoveredCarts: stats.recoveredCarts,
      badgeText: "منقذ من هالة AI 🇸🇦"
    }
  };
}

export const onRequestPost = withApi(digestHandler);
export const onRequestGet = withApi(digestHandler);

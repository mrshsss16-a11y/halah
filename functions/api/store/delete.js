// POST /api/store/delete — حذف ذاتي بطلب التاجر. تنسيق فقط؛ المنطق بـ
// `domain/accountDeletion.js`.
//
// body: { mode: "salla" | "account", confirm: "احذف بياناتي" }
//
// ثلاث بوابات قبل فعل لا رجعة فيه: حدّ معدل، جلسة حساب مكتمل (وبوابة CSRF
// داخل withApi)، وعبارة تأكيد مكتوبة يدوياً. الأخيرة ليست زينة — بدونها
// نقرة واحدة على رابط مُعدّ سلفاً تمحو متجراً كاملاً.
import { withApi, json } from "../../_lib/core/respond.js";
import { requireCompletedAccount, sessionCookieHeader } from "../../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { logError } from "../../_lib/core/errorLog.js";
import { deleteMerchantAccount, DELETE_CONFIRM_PHRASE, DELETE_MODES } from "../../_lib/domain/accountDeletion.js";

async function deleteHandler(body, env, request, requestId, context) {
  // 2026-09-17: fail-closed — فعل لا رجعة فيه، فعطل KV يجب أن يمنعه لا أن
  // يفتحه بلا حدّ. التاجر يعيد المحاولة؛ المحو لا يُعاد — SEC-9.
  const rl = await checkRateLimit(env, clientIp(request), "store_delete", 5, 3600, { failClosed: true });
  if (!rl.allowed) {
    return { error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" };
  }

  const merchantId = await requireCompletedAccount(request, env);
  const mode = DELETE_MODES.includes(body.mode) ? body.mode : "salla";

  // مقارنة بعد تطبيع المسافات فقط — لا تساهل بالنص نفسه.
  if (String(body.confirm || "").trim() !== DELETE_CONFIRM_PHRASE) {
    return { error: `اكتب «${DELETE_CONFIRM_PHRASE}» بالضبط للتأكيد.`, code: "CONFIRM_REQUIRED" };
  }

  const result = await deleteMerchantAccount(env, merchantId, mode);

  // صدق مع التاجر: نقول «جزئي» حين يكون جزئياً، ونترك أثراً نلاحقه.
  if (result.failed?.length) {
    logError(context, {
      requestId,
      path: "api/store/delete",
      code: "SELF_DELETE_PARTIAL",
      storeId: merchantId,
      internal: result.failed.join(" | ").slice(0, 300)
    });
  }

  const message = result.accountDeleted
    ? "تم حذف حسابك وكل بياناتك نهائياً. مع السلامة 🤍"
    : "تم فكّ ربط سلة وحذف بيانات متجرك نهائياً. حسابك باقٍ وتقدر تربط متجرك من جديد.";

  // الكوكي يُمسح بالوضعين: نسخة الجلسة ارتفعت فما عاد يتحقق أصلاً، ومسحه
  // يمنع شاشة «تعذّر الوصول لبياناتك» بعد حذفٍ ناجح.
  return json(
    {
      ok: true,
      partial: Boolean(result.failed?.length),
      accountDeleted: Boolean(result.accountDeleted),
      message
    },
    200,
    { "Set-Cookie": sessionCookieHeader("", { clear: true }) }
  );
}

export const onRequestPost = withApi(deleteHandler);

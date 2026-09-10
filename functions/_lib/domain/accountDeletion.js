// حذف ذاتي بطلب التاجر نفسه — لا بريد ولا انتظار ردّ منّا.
//
// قبل هذا الملف كان «حذف بياناتك» رابطاً لصفحة تقول «راسلنا». وهذا يكفي
// نصّياً لمراجعة سلة، لكنه لا يكفي واقعاً: التاجر الذي ربط متجره **من خارج**
// متجر تطبيقات سلة (سجّل بالموقع ثم ضغط «اربط متجر سلة») لا يملك زر «إزالة
// التطبيق» الذي يُشغّل `app.uninstalled`. فمساره الوحيد للحذف كان بريداً
// يدوياً — أي أن وعد «الحذف نهائي وفوري» يعتمد على أن نقرأ بريدنا.
//
// وضعان، والفرق بينهما مقصود:
//
//   "salla"   فكّ ربط سلة + محو بيانات المتجر، **والحساب يبقى**. لمن يريد
//             وقف وصولنا لمتجره دون أن يفقد بريده وكلمة مروره. يعيد الربط
//             بضغطة متى شاء.
//
//   "account" ما سبق + محو الحساب نفسه (accounts) وصفّ `merchants`. لا رجعة:
//             البريد يتحرّر ويصلح للتسجيل من جديد كحساب فارغ تماماً.
//
// كلاهما يرفع `session_version` قبل الحذف كي تسقط كل جلسة حيّة — بما فيها
// نسخة مسروقة على جهاز آخر (P40). ولذلك الترتيب ليس اعتباطياً:
//   ١) ارفع نسخة الجلسة (بينما `accounts` لا يزال موجوداً — بعد حذفه لا مكان
//      للرقم، فالرفع بعده لا أثر له)
//   ٢) اقطع سلة (توكنات + وظائف جارية)
//   ٣) امحُ بيانات المتجر
//   ٤) امحُ الحساب والصفّ (لوضع "account" فقط)
//
// لا يُنادى إلا من نقطة خلف `requireCompletedAccount` + بوابة CSRF + عبارة
// تأكيد مكتوبة يدوياً. الحذف نهائي ولا تراجع فيه.
import { purgeMerchantData } from "./merchantPurge.js";
import { revokeSallaConnection } from "./salla.js";
import { bumpSessionVersion } from "../core/session.js";

/** العبارة التي يكتبها التاجر حرفياً. عربية عمداً: لصقٌ أعمى أصعب من ضغطة. */
export const DELETE_CONFIRM_PHRASE = "احذف بياناتي";

export const DELETE_MODES = ["salla", "account"];

/**
 * ينفّذ الحذف ويرجّع تقريراً صادقاً عمّا نجح وما فشل.
 *
 * لا يرمي عند فشل جدول واحد: الحذف الجزئي أفضل من لا شيء، والتاجر يستحق
 * أن يعرف أنه جزئي بدل «تم الحذف ✅» كاذبة.
 */
export async function deleteMerchantAccount(env, merchantId, mode = "salla") {
  if (!env?.DB || !merchantId) return { ok: false, mode, failed: ["no-db"] };
  if (!DELETE_MODES.includes(mode)) return { ok: false, mode, failed: ["bad-mode"] };

  const failed = [];

  // ١) إسقاط الجلسات أولاً — بعد حذف `accounts` لا يبقى صفّ يحمل الرقم.
  await bumpSessionVersion(env, merchantId).catch((e) => failed.push(`session: ${msg(e)}`));

  // ٢) قطع سلة: توكنات محذوفة ووظائف جارية ملغاة قبل محو ما تكتب فيه.
  await revokeSallaConnection(env, merchantId).catch((e) => failed.push(`salla: ${msg(e)}`));

  // ٣) بيانات المتجر — نفس المحو الذي يجري عند `app.uninstalled` حرفياً.
  const purge = await purgeMerchantData(env, merchantId, { keepAccount: mode !== "account" });
  if (purge.failed?.length) failed.push(...purge.failed);

  if (mode !== "account") {
    return { ok: failed.length === 0, mode, tables: purge.tables, failed, accountDeleted: false };
  }

  // ٤) الحساب نفسه. `accounts` ضمن جداول المحو أصلاً (بـmerchant_id)، لكن
  //    التكرار هنا مقصود: لو أُخرج من تلك القائمة يوماً يبقى الحذف الكامل
  //    كاملاً فعلاً، لا يترك بريداً محجوزاً بلا بيانات خلفه.
  try {
    await env.DB.prepare("DELETE FROM accounts WHERE merchant_id = ?").bind(merchantId).run();
  } catch (e) {
    failed.push(`accounts: ${msg(e)}`);
  }

  // الصفّ الأخير. عند `app.uninstalled` نُبقيه مفرَّغاً كي تعمل إعادة الربط
  // بنفس المعرّف؛ هنا التاجر طلب المحو الكامل صراحةً فلا معنى لإبقائه.
  // فشله لا يُفشل العملية: مفتاح أجنبي متبقٍّ يعني صفاً فارغاً لا بيانات.
  try {
    await env.DB.prepare("DELETE FROM merchants WHERE id = ?").bind(merchantId).run();
  } catch (e) {
    failed.push(`merchants: ${msg(e)}`);
  }

  return { ok: failed.length === 0, mode, tables: purge.tables, failed, accountDeleted: true };
}

const msg = (e) => String(e?.message || e).slice(0, 80);

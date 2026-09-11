// حذف بيانات التاجر نهائياً عند إزالة التطبيق من سلة.
//
// الوعد الذي يقوله فيديو الاستخدام حرفياً: «بمجرد ما تحذف هالة، نحذف بياناتك
// نهائياً». السلوك السابق كان يحذف التوكنات فقط ويُبقي المنتجات والأوصاف
// ليستأنف التاجر لو أعاد التثبيت — نيّة طيبة، لكنها **تجعل الوعد كاذباً**،
// وهو ادعاء عن التعامل مع البيانات يقرأه مراجع سلة والتاجر معاً.
//
// لماذا الحذف الفوري مقبول هنا: الأوصاف المعتمَدة **منشورة على سلة أصلاً** —
// هذا هدف التطبيق. ما نحتفظ به نسخة عمل تُعاد بضغطة «اسحب منتجاتي». فالخسارة
// عند إعادة التثبيت دقيقة واحدة، والمكسب أن ما نقوله هو ما يحدث.
//
// ما لا يُحذف ولماذا:
//   - `merchants`: الصف نفسه يبقى بلا بيانات (معرّف فارغ). حذفه يكسر مفاتيح
//     أجنبية بسجلات تشغيلية، ويمنع إعادة الربط بنفس المعرّف لاحقاً.
//   - `audit_log`: سجل أفعال الأدمن — دليل مساءلة لا بيانات تاجر. حذفه يمحو
//     أثر من فعل ماذا، وهو عكس الغرض الذي وُجد له (P9).
//   - `error_log`: لا يحمل `merchant_id` كعمود تاجر بل `store_id` تشخيصياً،
//     ويُقلَّم بدورة حياته الخاصة.
//   - `consultation_bookings`: حجوزات استشارات أورا من موقعها العام — بلا عمود
//     `merchant_id` إطلاقاً، فليست بيانات تاجر. (أمسك الحارس PURGE-2 إدراجها
//     خطأً بأول نسخة من هذي القائمة.)
//
// الحذف **نهائي ولا تراجع فيه** — يُنادى من ويبهوك موقَّع فقط، لا من نقطة عامة.
import { listVectorRefs, deleteVectorIds } from "../ai/vectorStore.js";

/** دفعة حذف المتجهات — نفس حد الدفعة داخل `vectorStore.js`. */
const VECTOR_DELETE_BATCH = 50;

/**
 * جداول بيانات التاجر التي تُمحى بالكامل. مستخرجة من الهجرات: كل جدول فيه
 * عمود `merchant_id` عدا الاستثناءات الموثّقة أعلاه.
 *
 * القائمة صريحة لا مشتقّة وقت التشغيل: جدول جديد يجب أن **يُضاف هنا بوعي** —
 * وحارس `PURGE-1` يفشل إن ظهر جدول تاجر خارجها، فلا يبقى دَين صامت.
 */
export const PURGE_TABLES = [
  "oauth_tokens",
  "webhook_log",
  "abandoned_carts",
  "platform_connections",
  "marketing_contexts",
  "product_sync",
  "copy_history",
  "whatsapp_contacts",
  "whatsapp_messages",
  "usage_meter",
  "store_logos",
  "accounts",
  "merchant_faqs",
  "merchants_meta",
  "omnichannel_sessions",
  "pending_retargeting",
  "usage_quota",
  "wa_connections",
  "bulk_jobs",
  "review_queue",
  "ig_connections",
  "ig_processed_events",
  "store_products",
  "store_profiles",
  "agent_profiles",
  "merchant_feedback",
  // سجل معرّفات متجهات التاجر. صفوفه تسقط هنا **بعد** أن تُحذف المتجهات نفسها
  // بخطوة `purgeMerchantVectors` أدناه — الترتيب مقصود: الصف هو الدليل الوحيد
  // على وجود المتجه، فمحوه أولاً يترك نص التاجر بالمؤشر بلا سبيل لحذفه.
  "vector_refs"
];

/** جداول تاجر لا تُمحى — كل واحد بسببه. يقرؤها الحارس ليتأكد أن الترك واعٍ. */
export const PURGE_EXEMPT = {
  merchants: "الصف يبقى مفرَّغاً؛ حذفه يكسر إعادة الربط بنفس المعرّف",
  audit_log: "سجل مساءلة لأفعال الأدمن، لا بيانات تاجر (P9)"
};

/**
 * يحذف كل متجهات التاجر من Vectorize اعتماداً على سجل `vector_refs`.
 *
 * بلا ربط Vectorize لا خطوة أصلاً: `vectorStore.upsertVector` لا يكتب سجلاً إلا
 * بعد التأكد من الربط، فغيابه يعني أنه لم يُكتب متجه ولا صف — لا محو صامت
 * يُدّعى نجاحه. الفشل يُدرَج بـ`failed` كما تفعل الجداول، لا يُبتلع.
 */
async function purgeMerchantVectors(env, merchantId, failed) {
  if (!env?.VECTORIZE_INDEX) return;
  try {
    const ids = await listVectorRefs(env, merchantId);
    for (let i = 0; i < ids.length; i += VECTOR_DELETE_BATCH) {
      await deleteVectorIds(env, { storeId: merchantId, ids: ids.slice(i, i + VECTOR_DELETE_BATCH) });
    }
  } catch (err) {
    const msg = String(err?.message || err);
    if (!/no such table/i.test(msg)) failed.push(`vector_refs: ${msg.slice(0, 80)}`);
  }
}

/**
 * يمحو كل بيانات التاجر، ويُفرّغ صف `merchants` مما يُعرّفه.
 *
 * لا يرمي: الحذف يُنادى من مسار ويبهوك، وفشل جدول واحد يجب ألا يمنع محو
 * الباقي. يرجّع ما نجح وما فشل ليُسجَّل بصدق.
 */
export async function purgeMerchantData(env, merchantId, { keepAccount = false } = {}) {
  if (!env?.DB || !merchantId) return { purged: false, tables: 0, failed: [] };

  const failed = [];
  let purged = 0;

  // ذاكرة المتجهات أولاً: `vector_refs` نفسه ضمن الجداول أدناه، ومحو صفوفه قبل
  // حذف المتجهات يفقد المعرّفات إلى الأبد (Vectorize لا يحذف بفلتر metadata)،
  // فيبقى نص التاجر الخام بالمؤشر بينما نقول له إن بياناته مُحيت.
  await purgeMerchantVectors(env, merchantId, failed);

  // `keepAccount`: التاجر طلب فكّ ربط سلة ومحو بيانات متجره، **لا** حذف حسابه.
  // بدون هذا الاستثناء كان `accounts` ضمن المحو فيضيع بريده وكلمة مروره معه —
  // وهو ليس ما طلبه، ويمنعه من إعادة الربط بنفس الحساب بضغطة.
  const tables = keepAccount ? PURGE_TABLES.filter((t) => t !== "accounts") : PURGE_TABLES;

  for (const table of tables) {
    try {
      // اسم الجدول من ثابت داخلي لا من مدخل — لا حقن ممكن.
      await env.DB.prepare(`DELETE FROM ${table} WHERE merchant_id = ?`).bind(merchantId).run();
      purged += 1;
    } catch (err) {
      // جدول غير موجود بهذي البيئة (هجرة لم تُطبَّق) ليس فشلاً حقيقياً.
      const msg = String(err?.message || err);
      if (!/no such table/i.test(msg)) failed.push(`${table}: ${msg.slice(0, 80)}`);
    }
  }

  // بنود الوظائف تُعزَل عبر bulk_jobs.job_id لا بعمود مباشر — تُمحى بعدها.
  try {
    await env.DB
      .prepare("DELETE FROM bulk_job_items WHERE job_id NOT IN (SELECT id FROM bulk_jobs)")
      .run();
  } catch (err) {
    const msg = String(err?.message || err);
    if (!/no such table/i.test(msg)) failed.push(`bulk_job_items: ${msg.slice(0, 80)}`);
  }

  // الصف يبقى، ويُفرَّغ مما يُعرّف التاجر أو متجره.
  //
  // `salla_merchant_id = NULL` مقصود ومضاف 2026-09-10: العمود UNIQUE، فإبقاؤه
  // بعد محوٍ كامل يحتجز المتجر عند صفّ فارغ — التاجر لا يقدر يربطه بحساب آخر
  // (ولا بحساب مراجعة أو حساب فريق) لأن `linkSallaToAccount` يراه «مرتبطاً».
  // بعد أن طلب المحو صراحةً، احتجازُ المعرّف عقوبة بلا فائدة. إعادة التثبيت
  // تُنشئ صفاً جديداً بدل استئناف صفّ لم يبقَ فيه شيء يُستأنف.
  //
  // لا ينطبق على انتهاء الاشتراك/التجربة: ذاك المسار ينادي
  // `revokeSallaConnection` وحدها ولا يمرّ من هنا، فبياناته ومعرّفه يبقيان.
  try {
    await env.DB
      .prepare(
        `UPDATE merchants
            SET store_name = NULL, catalog_synced_at = NULL, last_active_at = NULL,
                salla_merchant_id = NULL, salla_disconnected_at = datetime('now')
          WHERE id = ?`
      )
      .bind(merchantId)
      .run();
  } catch (err) {
    failed.push(`merchants: ${String(err?.message || err).slice(0, 80)}`);
  }

  return { purged: true, tables: purged, failed };
}

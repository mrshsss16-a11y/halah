// نشر المخرجات المعتمدة (docs/INSTAGRAM_PLAN.md §٢.٢).
//
// هذه الطبقة هي **المكان الوحيد** الذي يُرسل منه مخرج AI لمنصة خارجية. أي مسار
// آخر يرسل مباشرة يتجاوز بوابة المراجعة البشرية — وهو أخطر ما يمكن كسره بالمشروع
// (اختبار IG-T7 بـtests/api.test.mjs يحرس ذلك على ويبهوك إنستغرام).
//
// عقد الاستدعاء: تُنادى **بعد** approve() فقط، بالصف الذي أعادته. لا تقرأ الطابور
// بنفسها ولا تقرر ما يُنشر — القرار اتُّخذ بشرياً قبلها.
import { getIgConnectionByUserId } from "../core/db.js";
import { send as igSend } from "../integrations/instagram.js";
import { updateProductBySku } from "../integrations/salla.js";
import { recordPublishResult } from "./reviewQueue.js";
import { markPublished } from "./catalog.js";
import { buildSallaProductFields } from "./sallaProductPayload.js";

/**
 * نافذة الإرسال انتهت؟ عنصر فات أوانه يفشل عند Meta برسالة غامضة — نرفضه قبل
 * المحاولة برسالة عربية مفهومة بدل خطأ مزوّد غير مفسَّر (M5).
 * expiresAt يُكتب بالويبهوك ساعة الاستلام (٧ أيام للتعليق، ٢٤ ساعة للرسالة).
 */
function windowExpired(payload) {
  if (!payload?.expiresAt) return false;
  const t = Date.parse(payload.expiresAt);
  return Number.isFinite(t) && t <= Date.now();
}

async function publishInstagram(env, { merchantId, payload }) {
  if (windowExpired(payload)) {
    throw new Error("فات وقت الرد — نافذة إنستغرام لهذا العنصر انتهت.");
  }

  // العزل: الاتصال يُقرأ بـig_user_id المخزّن بالحمولة، ثم **يُتحقق** أنه يخص
  // نفس التاجر صاحب الصف. حمولة معطوبة أو معدّلة لا يجوز أن ترسل باسم تاجر آخر.
  const conn = await getIgConnectionByUserId(env, payload.igId);
  if (!conn) {
    throw new Error("حساب إنستغرام غير مربوط — أعد الربط من لوحة التحكم.");
  }
  if (conn.merchant_id !== merchantId) {
    throw new Error("عدم تطابق بين حساب إنستغرام والمتجر — رُفض الإرسال.");
  }

  const mode = payload.mode === "dm" ? "dm" : "comment_reply";
  const result = await igSend(
    env,
    {
      conn,
      mode,
      commentId: payload.commentId,
      recipientId: payload.recipientId
    },
    { text: payload.draft }
  );

  // معرّف المزوّد يختلف باختلاف نقطة النهاية.
  return result?.id || result?.message_id || null;
}

/**
 * كتابة وصف معتمد على منتج سلة بالـSKU.
 *
 * الحقول: `description` (النص المعتمد كما اعتمده التاجر حرفياً — لا إعادة توليد
 * بعد القرار) + `metadata.title/description` من حزمة SEO. لو رفضت سلة حقول
 * metadata (٤٢٢) نعيد المحاولة بالوصف وحده مرة واحدة بدل إسقاط النشر كله —
 * الوصف هو الوعد الأساسي، وSEO تحسين فوقه.
 *
 * ٤٢٩ (حد المعدل): لا إعادة محاولة هنا إطلاقاً — يُرمى خطأ يحمل retryAfter
 * ليوقف الـcron التِك الحالي كاملاً لهذا المتجر (تجاوز الحد يقطع اتصال المتجر).
 */
async function publishDescription(env, { merchantId, payload }) {
  const sku = String(payload?.sku || "").trim();
  const description = String(payload?.description || "").trim();
  if (!sku) throw new Error("حمولة الوصف بلا رمز SKU — لا يمكن تحديد المنتج.");
  if (!description) throw new Error("حمولة الوصف فارغة — رُفض النشر.");

  // أسماء حقول سلة الحقيقية (metadata_title/metadata_description/subtitle، والوصف HTML)
  // من services/sallaProductPayload.js — المصدر الوحيد لهذا التحويل.
  const { fields, descriptionOnly, hasSeo } = buildSallaProductFields({
    description,
    excerpt: payload?.copywriting?.excerpt || payload?.excerpt || "",
    highlights: payload?.copywriting?.highlights || payload?.highlights || [],
    faqs: payload?.faqs || [],
    seo: payload?.seo || null
  });

  const attempt = async (body, fallback) => {
    try {
      return await updateProductBySku(env, merchantId, sku, body);
    } catch (err) {
      const status = Number(err?.status) || Number((String(err?.message || "").match(/HTTP (\d{3})/) || [])[1]) || 0;
      if (status === 429) {
        const e = new Error("سلة أوقفت الطلبات مؤقتاً (حد المعدل) — يُستأنف بالتِك التالي.");
        e.retryAfter = err?.retryAfter || true;
        throw e;
      }
      if (status === 422 && fallback) {
        // حقول السيو رُفضت — الوصف وحده مرة واحدة، ثم أي فشل يُسجَّل على الصف.
        return updateProductBySku(env, merchantId, sku, fallback);
      }
      throw err;
    }
  };

  const result = await attempt(fields, hasSeo ? descriptionOnly : null);
  await markPublished(env, { merchantId, sku, description }).catch(() => {});
  return String(result?.data?.id || sku);
}

/**
 * ينشر صفاً معتمداً ويسجّل النتيجة عليه.
 *
 * لا يرمي للمستدعي عند فشل النشر: الاعتماد نجح فعلاً، والفشل يُسجَّل على الصف
 * ليُعاد يدوياً. رمي الخطأ هنا يجعل استجابة "تم الاعتماد" تبدو فاشلة رغم أن
 * القرار البشري سُجِّل — وهذا تضليل للمراجع.
 *
 * @returns {Promise<{published: boolean, externalId: string|null, error: string|null}>}
 */
export async function publishApproved(env, row) {
  const merchantId = row?.merchant_id;
  const id = row?.id;

  let payload;
  try {
    payload = typeof row?.payload === "string" ? JSON.parse(row.payload) : row?.payload;
  } catch {
    payload = null;
  }

  // وصف منتج معتمد → يُكتب على سلة (المرحلة ٢، docs/COMPLETION_PATH.md).
  // يُستدعى من cron/bulk_process بفاصل ≥ ١.١ث لكل متجر — **لا** من endpoint
  // التاجر مباشرة، لأن حد سلة ١ طلب/ثانية يقطع اتصال المتجر كاملاً عند تجاوزه.
  if (row?.kind === "description") {
    try {
      const externalId = await publishDescription(env, { merchantId, payload });
      await recordPublishResult(env, { merchantId, id, externalId, error: null });
      return { published: true, externalId, error: null };
    } catch (err) {
      const error = String(err?.message || err).slice(0, 500);
      await recordPublishResult(env, { merchantId, id, error }).catch(() => {});
      return { published: false, externalId: null, error, retryAfter: err?.retryAfter || null };
    }
  }

  // أنواع بلا وجهة نشر خارجية (تقرير، صورة) — الاعتماد نفسه هو النتيجة.
  // تُسجَّل كمنشورة بلا معرّف خارجي حتى لا تظهر أبداً بقائمة "معتمد ولم يُنشر".
  if (row?.kind !== "social_reply") {
    await recordPublishResult(env, { merchantId, id, externalId: null, error: null }).catch(() => {});
    return { published: true, externalId: null, error: null };
  }

  if (!payload?.channel) {
    const error = "حمولة العنصر غير صالحة — لا قناة نشر محددة.";
    await recordPublishResult(env, { merchantId, id, error }).catch(() => {});
    return { published: false, externalId: null, error };
  }

  try {
    let externalId = null;
    switch (payload.channel) {
      case "instagram":
        externalId = await publishInstagram(env, { merchantId, payload });
        break;
      default:
        throw new Error(`قناة غير مدعومة للنشر: ${payload.channel}`);
    }
    await recordPublishResult(env, { merchantId, id, externalId, error: null });
    return { published: true, externalId, error: null };
  } catch (err) {
    const error = String(err?.message || err).slice(0, 500);
    await recordPublishResult(env, { merchantId, id, error }).catch(() => {});
    return { published: false, externalId: null, error };
  }
}

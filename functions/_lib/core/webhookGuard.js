// حرّاس الويبهوك المشتركون (SEC-2، 2026-09-17): سقف حجم **قبل** الـHMAC،
// ومنع تكرار الأحداث بعد التحقق من التوقيع.
//
// لماذا سقف قبل الـHMAC: حساب SHA-256 على الجسم الخام يتناسب طولياً مع حجمه،
// وطرف يعرف الرابط (بلا توقيع صحيح) يقدر يجبرنا على هضم ميغابايتات قبل الرفض.
// نفس الحدّ المطبَّق على إنستغرام (`domain/instagram.js` ٣.٣) معمّماً هنا.
//
// لماذا منع التكرار: Meta وسلة **تعيدان الإرسال** عند أي تأخر أو ٥٠٠ (سلة ٣
// محاولات). بلا حارس، إعادة الإرسال = رد ثانٍ على العميل نفسه وصرف ذكاء
// اصطناعي مكرّر. المفتاح بـKV بعمر ٢٤ ساعة — أطول بكثير من نافذة إعادة المحاولة.
import { logError } from "./errorLog.js";

export const MAX_WEBHOOK_BODY_BYTES = 512 * 1024;
const DEDUPE_TTL_S = 86400;

/**
 * يقرأ جسم الطلب بسقف حجم صارم. يرجّع النص، أو `null` إن تجاوز السقف
 * (فترجم النقطة ذلك إلى ٤١٣ بلا حساب أي توقيع).
 *
 * فحصان: `Content-Length` حين يُرسَل (رفض بلا قراءة أصلاً)، ثم الطول الفعلي
 * بعد القراءة — لأن الترويسة اختيارية وقابلة للكذب مع `Transfer-Encoding`.
 */
export async function readBoundedBody(request, maxBytes = MAX_WEBHOOK_BODY_BYTES) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) return null;
  return new TextDecoder().decode(buf);
}

let kvMissingLogged = false;

/**
 * يسجّل `key` كمعالَج ويرجّع `true` إن كان مسجَّلاً من قبل (⇒ تكرار، تجاهله).
 *
 * غياب ربط KV أو عطله **لا يوقف** المعالجة (نفس قرار المدير P28 بحدّ المعدل):
 * تكرار نادر أهون من تعطّل الويبهوك بالكامل. يُسجَّل مرة واحدة لكل عملية
 * حتى لا يغرق `error_log`.
 */
export async function seenEvent(env, key, ttl = DEDUPE_TTL_S) {
  const kv = env?.HALA_CACHE;
  if (!kv) {
    if (!kvMissingLogged) {
      kvMissingLogged = true;
      logError({ env }, { requestId: null, path: "core/webhookGuard", code: "WEBHOOK_DEDUPE_KV_MISSING", internal: "no KV binding — webhook dedupe disabled" });
    }
    return false;
  }
  const k = `wh:seen:${key}`;
  try {
    if (await kv.get(k)) return true;
    await kv.put(k, "1", { expirationTtl: Math.max(60, ttl) });
    return false;
  } catch (error) {
    logError({ env }, { requestId: null, path: "core/webhookGuard", code: "WEBHOOK_DEDUPE_FAILED", internal: `${key}: ${error?.message || error} — processing anyway` });
    return false;
  }
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text || "")));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/**
 * مفتاح تكرار لحدث سلة: حمولاتها بلا معرّف حدث، فالبديل الثابت هو
 * (الحدث + التاجر + ختم الإنشاء). حين ينقص أحدها نبصم الجسم الخام —
 * إعادة الإرسال من سلة حرفية، فالبصمة تتطابق.
 */
export async function sallaEventKey(payload, rawBody) {
  const event = String(payload?.event || "unknown");
  const merchant = payload?.merchant ?? payload?.data?.merchant ?? null;
  const stamp = payload?.created_at ?? payload?.timestamp ?? null;
  if (merchant && stamp) return `salla:${event}:${merchant}:${stamp}`;
  return `salla:${event}:${await sha256Hex(rawBody)}`;
}

/**
 * يرشّح العناصر المكرَّرة من دفعة (رسائل واتساب مثلاً) بدل إسقاط الدفعة كلها:
 * رسالة واحدة مكرَّرة لا تمنع أخواتها الجديدة بنفس الطلب.
 * عنصر بلا مفتاح يمرّ كما هو (لا نعرف هويته ⇒ لا ندّعي أنه مكرَّر).
 */
export async function filterUnseen(env, items, keyOf, ttl = DEDUPE_TTL_S) {
  const out = [];
  for (const item of items || []) {
    const key = keyOf(item);
    if (!key) { out.push(item); continue; }
    if (!(await seenEvent(env, key, ttl))) out.push(item);
  }
  return out;
}

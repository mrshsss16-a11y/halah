// حراس مدخلات بوابة المراجعة — استُخرجت من review.js بالمرحلة ٣ ليبقى الملف
// تحت سقف ٤٠٠ سطر (ARCHITECTURE §٤). صفر تغيير سلوكي: نفس الثوابت ونفس
// الرسائل ونفس الأكواد حرفياً.
import { DomainError } from "../core/errors.js";

export const REVIEW_KINDS = ["report", "social_reply", "image", "description"];
const MAX_PAYLOAD_CHARS = 20000;
export const MAX_REASON_CHARS = 500;

/** رسالة عربية للمستخدم؛ التفاصيل التقنية تروح لسجل الأخطاء عبر withApi. */
export function invalid(message, internal) {
  return new DomainError(400, message, "REVIEW_INVALID", internal);
}

export function requireMerchantId(merchantId) {
  if (typeof merchantId !== "string" || !merchantId.trim()) {
    throw invalid("المتجر غير محدد.", "reviewQueue: missing merchantId");
  }
  return merchantId.trim();
}

export function requireDb(env) {
  if (!env?.DB) {
    throw new DomainError(503, "الخدمة غير متاحة حالياً.", "DB_UNAVAILABLE", "reviewQueue: DB binding missing");
  }
  return env.DB;
}

export function requireId(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) {
    throw invalid("رقم العنصر غير صالح.", "reviewQueue: invalid id");
  }
  return n;
}

/** payload يُخزَّن نصاً — كائن يُسلسَل، نص يُقبل كما هو. */
export function normalizePayload(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload ?? null);
  if (!text || text === "null" || !text.trim()) {
    throw invalid("المحتوى المطلوب مراجعته فارغ.", "reviewQueue: empty payload");
  }
  if (text.length > MAX_PAYLOAD_CHARS) {
    throw invalid("المحتوى المطلوب مراجعته كبير جداً.", `reviewQueue: payload ${text.length} chars`);
  }
  return text;
}


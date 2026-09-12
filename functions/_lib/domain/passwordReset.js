// مجال استعادة كلمة المرور برابط بالبريد (يحلّ محل رمز الـ٦ أرقام).
//
// التصميم:
//  - توكن ٣٢ بايت عشوائية (base64url، ٤٣ حرفاً) — لا يُخمَّن، فلا حاجة لعدّاد تخمين.
//  - يُخزَّن **مجزّأً** (SHA-256) بعمود `password_resets.reset_token`؛ قراءة D1 وحدها
//    لا تمنح رابطاً صالحاً. الصف مفتاحه البريد: طلب جديد يُبطل الرابط السابق.
//  - صلاحية ٣٠ دقيقة، استخدام واحد: الاستهلاك `DELETE … RETURNING` ذرّي — طلبان
//    متوازيان بنفس الرابط لا ينجح منهما إلا واحد.
//  - الرابط يُبنى على أصل الإنتاج الثابت، **لا** من رأس Host (منع تسميم الرابط).
//  - غياب مزوّد البريد = `emailResetReady` false ⇒ نقطة النهاية ترد 503 صريحة للجميع
//    (لا ادعاء إرسال، ولا تمييز بين بريد مسجّل وغيره).
import { isConfigured as emailConfigured, send as sendEmail } from "../integrations/email.js";

export const RESET_TTL_MINUTES = 30;
const RESET_LINK_ORIGIN = "https://halah.aura.sa";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** توكن الرابط الخام (يُرسل بالبريد فقط، لا يُخزَّن ولا يُسجَّل). */
export function generateResetToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** تجزئة التوكن للتخزين والبحث. */
export async function hashResetToken(token) {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`pwreset:${token}`)));
}

/** مفتاح حد المعدل لكل بريد — مجزّأ حتى لا يُكتب البريد نفسه بمفاتيح KV. */
export async function resetEmailRateKey(email) {
  return `e:${(await hashResetToken(`email:${email}`)).slice(0, 32)}`;
}

export function isWellFormedResetToken(token) {
  return typeof token === "string" && TOKEN_RE.test(token);
}

export function resetLink(token) {
  return `${RESET_LINK_ORIGIN}/reset-password#token=${token}`;
}

/** هل قناة البريد مضبوطة (RESEND_API_KEY + EMAIL_FROM)؟ */
export function emailResetReady(env) {
  return emailConfigured(env);
}

/**
 * يخزّن تجزئة التوكن (يستبدل أي رابط سابق لنفس البريد). يرمي عند فشل D1 —
 * لا بريد يُرسل برابط لم يُحفظ.
 * secret-plaintext-ok: `reset_token` يحمل تجزئة SHA-256 لا التوكن — لا مسار لاستعادته.
 */
export async function storeResetToken(env, { email, tokenHash }) {
  // otp_code عمود NOT NULL أثري من تدفق الرمز السابق — يُكتب فارغاً ولا يُقرأ.
  await env.DB.prepare(
    `INSERT INTO password_resets (email, otp_code, reset_token, expires_at, created_at)
     VALUES (?, '', ?, datetime('now', '+' || ? || ' minutes'), datetime('now'))
     ON CONFLICT (email) DO UPDATE SET
       otp_code = '', reset_token = excluded.reset_token,
       expires_at = excluded.expires_at, created_at = excluded.created_at`
  )
    .bind(email, tokenHash, RESET_TTL_MINUTES)
    .run();
}

/**
 * يستهلك الرابط ذرّياً ويعيد البريد المرتبط به، أو null (مجهول/منتهٍ/مستخدم).
 * البريد يأتي من صف D1 — لا من العميل.
 */
export async function consumeResetToken(env, token) {
  if (!isWellFormedResetToken(token)) return null;
  const row = await env.DB.prepare(
    `DELETE FROM password_resets
      WHERE reset_token = ? AND expires_at > datetime('now')
      RETURNING email`
  )
    .bind(await hashResetToken(token))
    .first();
  return row?.email || null;
}

/**
 * يكتب كلمة المرور الجديدة لحساب صاحب الرابط. `merchantId` يُحلّ من بريد صف
 * الاستهلاك (ملكية مُثبتة بالرابط)، لا من العميل. يرمي عند فشل D1.
 */
export async function setAccountPassword(env, { merchantId, hash, salt }) {
  const res = await env.DB.prepare("UPDATE accounts SET password_hash = ?, password_salt = ? WHERE merchant_id = ?")
    .bind(hash, salt, merchantId)
    .run();
  return Number(res?.meta?.changes ?? 1) > 0;
}

/** محتوى الرسالة — نص صريح + HTML عربي RTL بسيط، بلا تسويق. */
function resetEmailContent(link) {
  const subject = "استعادة كلمة المرور — هالة";
  const text = [
    "مرحباً،",
    "",
    "وصلنا طلب لاستعادة كلمة المرور لحسابك في هالة. لتعيين كلمة مرور جديدة افتح الرابط:",
    link,
    "",
    `الرابط صالح ${RESET_TTL_MINUTES} دقيقة ويعمل مرة واحدة فقط.`,
    "إن لم تطلب ذلك فتجاهل هذه الرسالة — كلمة مرورك الحالية لم تتغير.",
    "",
    "هالة — أورا للتسويق"
  ].join("\n");
  const html = `<!doctype html><html dir="rtl" lang="ar"><body style="margin:0;padding:24px;background:#ffffff;font-family:Tahoma,Arial,sans-serif;color:#111111;direction:rtl;text-align:right">
<div style="max-width:480px;margin:0 auto;border:1px solid #111111;border-radius:16px;padding:24px">
<p style="margin:0 0 12px">مرحباً،</p>
<p style="margin:0 0 16px;line-height:1.8">وصلنا طلب لاستعادة كلمة المرور لحسابك في هالة. لتعيين كلمة مرور جديدة اضغط الزر:</p>
<p style="margin:0 0 16px"><a href="${link}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold">تعيين كلمة مرور جديدة</a></p>
<p style="margin:0 0 8px;font-size:13px;line-height:1.8">الرابط صالح ${RESET_TTL_MINUTES} دقيقة ويعمل مرة واحدة فقط.</p>
<p style="margin:0 0 16px;font-size:13px;line-height:1.8">إن لم تطلب ذلك فتجاهل هذه الرسالة — كلمة مرورك الحالية لم تتغير.</p>
<p style="margin:0;font-size:12px;color:#555555;direction:ltr;text-align:left;word-break:break-all">${link}</p>
</div></body></html>`;
  return { subject, text, html };
}

/** يرسل رابط الاستعادة. يرمي عند فشل المزوّد (المستدعي يسجّل بلا بريد ولا توكن). */
export async function sendResetEmail(env, { email, token }) {
  const { subject, text, html } = resetEmailContent(resetLink(token));
  return sendEmail(env, { to: email, subject, text, html });
}

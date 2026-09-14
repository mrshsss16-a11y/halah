// حساب التاجر + بريد الترحيب عند تثبيت هالة من متجر تطبيقات سلة (Easy Mode).
//
// متطلب اجتماع ما قبل الإطلاق مع فريق سلة (2026-09-15): «بعد تثبيت التطبيق … إنشاء حساب للتاجر في نظام
// خدمتك ثم إرسال بريد ترحيب للتاجر». قبله كان التثبيت يحفظ التوكنات فقط، والحساب لا يُنشأ إلا لو ربطه
// التاجر يدوياً («عندك حساب؟» أو جوجل).
//
// المصدر الوحيد للبريد: `accounts.salla.sa/oauth2/user/info` بتوكن التثبيت نفسه — لا بريد من العميل.
// الحساب بكلمة مرور عشوائية لا يعرفها أحد: الدخول الأساسي من داخل سلة، ومن الموقع بـ«نسيت كلمة المرور».
// البريد مرة واحدة لكل متجر (تكرار الويبهوك وإعادة التثبيت لا يرسلان ثانية). لا بريد في السجلات.
import { hashPassword } from "../core/auth.js";
import { accountEmailFor, emailTaken, completeAccount } from "./accounts.js";
import { isConfigured as emailConfigured, send as sendEmail } from "../integrations/email.js";

const USERINFO_URL = "https://accounts.salla.sa/oauth2/user/info";
const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;
const WELCOME_FLAG_TTL = 400 * 24 * 60 * 60;
const SITE = "https://halah.aura.sa";

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** مالك المتجر كما تعرّفه سلة. يرمي عند فشل الطلب (المستدعي يسجّل ولا يُسقط التثبيت). */
async function fetchSallaOwner(accessToken) {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`user_info_failed:${res.status}`);
  const d = (await res.json().catch(() => ({})))?.data || {};
  return {
    email: String(d.email || "").trim().toLowerCase(),
    name: String(d.name || "").trim().slice(0, 80),
    storeName: String(d.merchant?.name || "").trim().slice(0, 120)
  };
}

/** محتوى بريد الترحيب — نص صريح + HTML عربي RTL، بلا وعود بميزات غير موجودة. */
export function welcomeEmailContent({ name, storeName, email }) {
  const hello = name ? `أهلاً ${name}،` : "أهلاً،";
  const store = storeName ? `متجر «${storeName}»` : "متجرك";
  const subject = "أهلاً بك في هالة — حسابك جاهز";
  const text = [
    hello,
    "",
    `تم تثبيت هالة على ${store} وإنشاء حسابك بهذا البريد: ${email}`,
    "",
    "للبدء:",
    "١. من لوحة تحكم متجرك في سلة افتح «التطبيقات» ثم «تطبيقاتي» ثم «هالة».",
    "٢. من «منتجاتي» اختر منتجاً، واكتب (اختياري) ما يميزه، ثم «اكتب الوصف الآن».",
    "٣. راجع الوصف وعدّله إن أردت، ثم انشره على متجرك — لا يُنشر شيء دون اعتمادك.",
    "",
    `للدخول من الموقع: ${SITE}/login ثم «نسيت كلمة المرور» بهذا البريد لتعيين كلمة مرور.`,
    "للمساعدة: info@aura.sa",
    "",
    "هالة — أورا للتسويق"
  ].join("\n");
  const html = `<!doctype html><html dir="rtl" lang="ar"><body style="margin:0;padding:24px;background:#ffffff;font-family:Tahoma,Arial,sans-serif;color:#111111;direction:rtl;text-align:right">
<div style="max-width:520px;margin:0 auto;border:1px solid #111111;border-radius:16px;padding:24px">
<p style="margin:0 0 12px;font-size:16px;font-weight:bold">${escapeHtml(hello)}</p>
<p style="margin:0 0 16px;line-height:1.8">تم تثبيت هالة على ${escapeHtml(store)} وإنشاء حسابك بهذا البريد: <b dir="ltr">${escapeHtml(email)}</b></p>
<p style="margin:0 0 8px;font-weight:bold">للبدء:</p>
<ol style="margin:0 0 16px;padding-right:20px;line-height:1.9">
<li>من لوحة تحكم متجرك في سلة افتح «التطبيقات» ثم «تطبيقاتي» ثم «هالة».</li>
<li>من «منتجاتي» اختر منتجاً، واكتب (اختياري) ما يميزه، ثم «اكتب الوصف الآن».</li>
<li>راجع الوصف وعدّله إن أردت، ثم انشره على متجرك — لا يُنشر شيء دون اعتمادك.</li>
</ol>
<p style="margin:0 0 16px;font-size:13px;line-height:1.8">للدخول من الموقع: افتح <a href="${SITE}/login" style="color:#111111">${SITE}/login</a> ثم «نسيت كلمة المرور» بهذا البريد لتعيين كلمة مرور.</p>
<p style="margin:0;font-size:13px">للمساعدة: <a href="mailto:info@aura.sa" style="color:#111111">info@aura.sa</a></p>
</div></body></html>`;
  return { subject, text, html };
}

/**
 * يُستدعى بعد حفظ توكنات `app.store.authorize`. يرجع ملخصاً بلا بيانات شخصية:
 * { account: created|exists|email_taken|skipped, email: sent|already_sent|not_configured|skipped }.
 */
export async function ensureAccountAndWelcome(env, { merchantId, accessToken, onLog = () => {} }) {
  const owner = await fetchSallaOwner(accessToken);
  if (!EMAIL_RE.test(owner.email)) {
    onLog("SALLA_OWNER_EMAIL_MISSING", merchantId, "user/info returned no valid email");
    return { account: "skipped", email: "skipped" };
  }

  let account = "exists";
  const current = (await accountEmailFor(env, merchantId))?.email || null;
  if (!current) {
    if (await emailTaken(env, owner.email)) {
      // البريد لحساب آخر (سجّل من الموقع أولاً): لا حساب ثانٍ بنفس البريد — الربط يدوي بـ«عندك حساب؟».
      account = "email_taken";
    } else {
      const { hash, salt } = await hashPassword(hex(crypto.getRandomValues(new Uint8Array(32))));
      await completeAccount(env, { merchantId, email: owner.email, hash, salt });
      account = "created";
    }
  }

  const flagKey = `welcome:${merchantId}`;
  if (env.HALA_CACHE && (await env.HALA_CACHE.get(flagKey).catch(() => null))) return { account, email: "already_sent" };
  if (!emailConfigured(env)) {
    onLog("WELCOME_EMAIL_NOT_CONFIGURED", merchantId, "RESEND_API_KEY/EMAIL_FROM missing — welcome not sent");
    return { account, email: "not_configured" };
  }
  const to = current || owner.email;
  await sendEmail(env, { to, ...welcomeEmailContent({ name: owner.name, storeName: owner.storeName, email: to }) });
  if (env.HALA_CACHE) await env.HALA_CACHE.put(flagKey, new Date().toISOString(), { expirationTtl: WELCOME_FLAG_TTL }).catch(() => {});
  return { account, email: "sent" };
}

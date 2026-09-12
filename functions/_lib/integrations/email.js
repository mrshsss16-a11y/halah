// محوّل البريد — عقد المحوّل الموحّد (docs/PARALLEL_TRACKS.md §أ.٣): isConfigured + send.
//
// المزوّد: Resend (https://api.resend.com/emails). السر `RESEND_API_KEY` والمرسِل
// `EMAIL_FROM` (مثل "هالة <no-reply@aura.sa>" — يتطلب توثيق الدومين عند Resend).
// غياب أي منهما = isConfigured false، وsend ترمي — لا "تمرير برشاقة" ولا ادعاء إرسال.
//
// قرار المالك المطلوب (COMPLETION_PATH 3.3): فتح حساب Resend + توثيق aura.sa + رفع
// السرّين. حتى ذلك الحين تدفق تحقق البريد مبني لكنه يرد "غير مفعّل" بصدق.
const RESEND_URL = "https://api.resend.com/emails";

export function isConfigured(env) {
  return Boolean(env?.RESEND_API_KEY && env?.EMAIL_FROM);
}

export async function send(env, { to, subject, text, html }) {
  if (!isConfigured(env)) {
    throw new Error("البريد غير مفعّل — RESEND_API_KEY أو EMAIL_FROM غير مضبوطين.");
  }
  const payload = { from: env.EMAIL_FROM, to: [to], subject, text };
  if (html) payload.html = html;
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`email provider HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => ({}));
  return data?.id || null;
}

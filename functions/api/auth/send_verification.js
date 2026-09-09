// POST /api/auth/send_verification — يرسل رمز تحقق ملكية البريد لحساب الجلسة الحالية.
//
// P38 طبقة ٢ / P41 (docs/COMPLETION_PATH.md 3.3): حسابات كلمة المرور تُنشأ بلا إثبات أن
// البريد يخص من سجّل. هذا التدفق يثبته: رمز ٦ أرقام مخزّن مُجزّأً (SHA-256 مع البريد)،
// صالح ١٥ دقيقة، ٥ محاولات ثم يُحرق — نفس نمط استعادة كلمة المرور (P39).
//
// الصدق: لا مزوّد بريد مضبوط = نرد "غير مفعّل" (503) — لا ندّعي إرسالاً لم يحدث.
// التفعيل يحتاج RESEND_API_KEY + EMAIL_FROM (قرار المالك). حسابات Google متحقَّقة سلفاً.
import { withApi, json } from "../../_lib/core/respond.js";
import { getSessionMerchantId } from "../../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { isConfigured as emailConfigured, send as sendEmail } from "../../_lib/integrations/email.js";
import { logError } from "../../_lib/core/errorLog.js";

export async function hashVerificationCode(email, code) {
  const data = new TextEncoder().encode(`verify:${email}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateCode() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + (buf[0] % 900000));
}

async function sendVerificationHandler(body, env, request, requestId, context) {
  const rl = await checkRateLimit(env, clientIp(request), "send_verification", 3, 600, { failClosed: true });
  if (!rl.allowed) {
    return json({ ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" }, 429);
  }

  const merchantId = await getSessionMerchantId(request, env);
  if (!merchantId) return json({ ok: false, error: "سجّل دخولك أولاً.", code: "LOGIN_REQUIRED" }, 401);
  if (!env?.DB) return json({ ok: false, error: "الخدمة غير متاحة حالياً.", code: "DB_UNAVAILABLE" }, 503);

  const account = await env.DB.prepare("SELECT email, email_verified_at FROM accounts WHERE merchant_id = ?").bind(merchantId).first();
  if (!account?.email) return json({ ok: false, error: "أكمل تسجيل حسابك أولاً.", code: "ACCOUNT_REQUIRED" }, 403);
  if (account.email_verified_at) return json({ ok: true, alreadyVerified: true, message: "بريدك متحقَّق منه مسبقاً." });

  if (!emailConfigured(env)) {
    return json({ ok: false, error: "تحقق البريد غير مفعّل حالياً.", code: "EMAIL_NOT_CONFIGURED" }, 503);
  }

  const code = generateCode();
  const codeHash = await hashVerificationCode(account.email, code);
  await env.DB.prepare(
    `INSERT INTO email_verifications (email, code_hash, attempts, expires_at)
     VALUES (?, ?, 0, datetime('now', '+15 minutes'))
     ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at, created_at = datetime('now')`
  )
    .bind(account.email, codeHash)
    .run();

  try {
    await sendEmail(env, {
      to: account.email,
      subject: "رمز تأكيد بريدك — هالة",
      text: `رمز تأكيد بريدك: ${code}\nصالح ١٥ دقيقة. لا تشاركه مع أحد.`
    });
  } catch (err) {
    logError(context, { requestId, path: "auth/send_verification", code: "EMAIL_SEND_FAILED", storeId: merchantId, internal: String(err?.message || err).slice(0, 250) });
    return json({ ok: false, error: "تعذّر إرسال رمز التحقق حالياً. حاول بعد قليل.", code: "EMAIL_SEND_FAILED" }, 502);
  }

  return json({ ok: true, message: "أرسلنا رمز التحقق لبريدك. صالح ١٥ دقيقة." });
}

export const onRequestPost = withApi(sendVerificationHandler);

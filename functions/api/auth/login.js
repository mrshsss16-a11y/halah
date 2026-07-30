import { json } from "../../_lib/core/respond.js";
import { verifyPassword, hashPassword } from "../../_lib/core/auth.js";
import { createSessionToken, sessionCookieHeader } from "../../_lib/core/session.js";
import { isAccountDisabled, isLoginLocked, recordLoginFailure, clearLoginAttempts } from "../../_lib/core/db.js";
import { sanitizeInput, verifyTurnstileToken } from "../../_lib/core/security.js";
import { checkRateLimit } from "../../_lib/core/rateLimit.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  const clientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "127.0.0.1";
  const rateCheck = await checkRateLimit(env, clientIp, "login_attempt", 10, 60);
  if (!rateCheck.allowed) {
    return json({ ok: false, error: `محاولات دخول كثيرة جداً. حاول بعد ${rateCheck.resetInSeconds} ثانية.` }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "طلب غير صالح." }, 400);
  }

  if (body.turnstileToken) {
    const turnstile = await verifyTurnstileToken(env, body.turnstileToken, clientIp);
    if (!turnstile.success) {
      return json({ ok: false, error: "فشل فحص الأمان لمكافحة البوتات (Turnstile)." }, 400);
    }
  }

  const email = sanitizeInput((body.email || "").toString().trim().toLowerCase(), 200);
  const password = (body.password || "").toString();

  if (email && (await isLoginLocked(env, email))) {
    return json(
      { ok: false, error: "محاولات كثيرة فاشلة — الحساب مقفل مؤقتاً، حاول بعد ١٥ دقيقة." },
      429
    );
  }

  let account = null;
  if (env?.DB) {
    account = await env.DB.prepare("SELECT * FROM accounts WHERE email = ?").bind(email).first().catch(() => null);
  }

  if (!account || !(await verifyPassword(password, account.password_hash, account.password_salt).catch(() => false))) {
    if (email && env?.DB) await recordLoginFailure(env, email).catch(() => {});
    return json({ ok: false, error: "البريد أو كلمة المرور غير صحيحة." }, 401);
  }

  if (await isAccountDisabled(env, account.merchant_id)) {
    return json({ ok: false, error: "هذا الحساب معطّل. تواصل مع فريق هالة." }, 403);
  }

  await clearLoginAttempts(env, email).catch(() => {});

  const merchant = await env.DB.prepare("SELECT store_name FROM merchants WHERE id = ?")
    .bind(account.merchant_id)
    .first();

  const adminEmails = (env?.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const isAdmin = adminEmails.includes(email.toLowerCase());
  const token = await createSessionToken(env, account.merchant_id);
  return json(
    { ok: true, storeId: account.merchant_id, email, storeName: merchant?.store_name ?? "أورا للتسويق", isAdmin },
    200,
    { "Set-Cookie": sessionCookieHeader(token) }
  );
}

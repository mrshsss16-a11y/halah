import { json } from "../../_lib/core/respond.js";
import { assertTrustedWrite } from "../../_lib/core/csrf.js";
import { verifyPassword, hashPassword } from "../../_lib/core/auth.js";
import { createSessionToken, sessionCookieHeader } from "../../_lib/core/session.js";
import { isAccountDisabled, isLoginLocked, recordLoginFailure, clearLoginAttempts } from "../../_lib/core/db.js";
import { sanitizeInput, verifyTurnstileToken, turnstileRequired } from "../../_lib/core/security.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { logError } from "../../_lib/core/errorLog.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  // P42 — CSRF gate (Origin allowlist + JSON-only body) for this raw handler.
  try {
    assertTrustedWrite(request, env);
  } catch (err) {
    return json({ ok: false, error: err.message, code: err.code || "CSRF_REJECTED" }, err.status || 403);
  }

  const ip = clientIp(request);
  // N3 — fail-closed هنا تحديداً: fail-open على تسجيل الدخول يعني نافذة تخمين
  // كلمات مرور بلا حد كلما تعطّل KV. الباقي (بوت أورا) يبقى fail-open بقرار P28.
  const rateCheck = await checkRateLimit(env, ip, "login_attempt", 10, 60, { failClosed: true });
  if (!rateCheck.allowed) {
    return json({ ok: false, error: `محاولات دخول كثيرة جداً. حاول بعد ${rateCheck.resetInSeconds} ثانية.` }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "طلب غير صالح." }, 400);
  }

  // N7 — متى وُجد TURNSTILE_SECRET_KEY صار التوكن إلزامياً: الشرط القديم
  // ("لو أرسل العميل توكن") ترك تعطيل الطبقة بيد المهاجم نفسه. بلا مفتاح
  // يبقى السلوك القديم كما هو — الطبقة معطّلة أصلاً ولا معنى لحجب الدخول.
  if (turnstileRequired(env) || body.turnstileToken) {
    const turnstile = await verifyTurnstileToken(env, body.turnstileToken, ip);
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

  if (!env?.DB) {
    // Q2 — قاعدة البيانات غائبة ليست "حساب غير موجود": الرد الصادق ٥٠٣.
    logError({ env }, { requestId: null, path: "/api/auth/login", code: "LOGIN_DB_UNAVAILABLE", internal: "DB binding missing" });
    return json({ ok: false, error: "الخدمة غير متاحة حالياً — حاول بعد قليل." }, 503);
  }

  let account = null;
  try {
    // tenant-audit-ok: identity resolution pre-auth — email IS the lookup key,
    // there is no merchant_id to scope by until this query resolves one.
    account = await env.DB.prepare("SELECT * FROM accounts WHERE email = ?").bind(email).first();
  } catch (err) {
    // Q2 — كان ابتلاع الخطأ (catch → null) يحوّل عطل D1 إلى "البريد أو كلمة المرور غير
    // صحيحة": التاجر يظن حسابه محذوفاً ولا أثر للعطل بأي سجل. بلا بريد بالسجل.
    logError({ env }, { requestId: null, path: "/api/auth/login", code: "LOGIN_DB_QUERY_FAILED", internal: err?.message || String(err) });
    return json({ ok: false, error: "الخدمة غير متاحة حالياً — حاول بعد قليل." }, 503);
  }

  let passwordOk = false;
  if (account) {
    try {
      passwordOk = await verifyPassword(password, account.password_hash, account.password_salt);
    } catch (err) {
      // فشل تحقق التجزئة نفسه (صف تالف/خوارزمية) — يُسجَّل ويُعامَل كفشل دخول.
      logError({ env }, { requestId: null, path: "/api/auth/login", code: "LOGIN_VERIFY_FAILED", storeId: account.merchant_id || null, internal: err?.message || String(err) });
      passwordOk = false;
    }
  }

  if (!passwordOk) {
    if (email) {
      await recordLoginFailure(env, email).catch((err) =>
        logError({ env }, { requestId: null, path: "/api/auth/login", code: "LOGIN_FAILURE_RECORD_FAILED", internal: err?.message || String(err) })
      );
    }
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

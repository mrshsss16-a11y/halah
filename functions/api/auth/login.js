// POST /api/auth/login — المرحلة ٤: تنسيق فقط (بوابة CSRF من withApi، وكل SQL
// بـ`domain/accounts.js`). نفس الرسائل والحالات والكوكي حرفياً.
import { withApi, json } from "../../_lib/core/respond.js";
import { verifyPassword } from "../../_lib/core/auth.js";
import { createSessionToken, sessionCookieHeader } from "../../_lib/core/session.js";
import { isLoginLocked, recordLoginFailure, clearLoginAttempts } from "../../_lib/domain/auth.js";
import { findAccountByEmail, isAccountDisabled, getStoreName } from "../../_lib/domain/accounts.js";
import { sanitizeInput, verifyTurnstileToken, turnstileRequired } from "../../_lib/core/security.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { logError } from "../../_lib/core/errorLog.js";

const log = (env, code, extra = {}) =>
  logError({ env }, { requestId: null, path: "/api/auth/login", code, ...extra });

async function loginHandler(body, env, request) {
  const ip = clientIp(request);
  // N3 — fail-closed هنا: fail-open يعني نافذة تخمين كلمات مرور كلما تعطّل KV.
  const rl = await checkRateLimit(env, ip, "login_attempt", 10, 60, { failClosed: true });
  if (!rl.allowed) return json({ ok: false, error: `محاولات دخول كثيرة جداً. حاول بعد ${rl.resetInSeconds} ثانية.` }, 429);

  // N7 — متى وُجد TURNSTILE_SECRET_KEY صار التوكن إلزامياً (وإلا فالتعطيل بيد المهاجم).
  if (turnstileRequired(env) || body.turnstileToken) {
    const turnstile = await verifyTurnstileToken(env, body.turnstileToken, ip);
    if (!turnstile.success) return json({ ok: false, error: "فشل فحص الأمان لمكافحة البوتات (Turnstile)." }, 400);
  }

  const email = sanitizeInput((body.email || "").toString().trim().toLowerCase(), 200);
  const password = (body.password || "").toString();

  if (email && (await isLoginLocked(env, email))) return json({ ok: false, error: "محاولات كثيرة فاشلة — الحساب مقفل مؤقتاً، حاول بعد ١٥ دقيقة." }, 429);

  if (!env?.DB) {
    // Q2 — DB غائبة ليست "حساب غير موجود": الرد الصادق ٥٠٣.
    log(env, "LOGIN_DB_UNAVAILABLE", { internal: "DB binding missing" });
    return json({ ok: false, error: "الخدمة غير متاحة حالياً — حاول بعد قليل." }, 503);
  }

  let account = null;
  try {
    account = await findAccountByEmail(env, email);
  } catch (err) {
    // Q2 — الابتلاع كان يحوّل عطل D1 إلى "البريد أو كلمة المرور غير صحيحة".
    log(env, "LOGIN_DB_QUERY_FAILED", { internal: err?.message || String(err) });
    return json({ ok: false, error: "الخدمة غير متاحة حالياً — حاول بعد قليل." }, 503);
  }

  let passwordOk = false;
  if (account) {
    try {
      passwordOk = await verifyPassword(password, account.password_hash, account.password_salt);
    } catch (err) {
      // فشل التجزئة نفسها (صف تالف) — يُسجَّل ويُعامَل كفشل دخول.
      log(env, "LOGIN_VERIFY_FAILED", { storeId: account.merchant_id || null, internal: err?.message || String(err) });
    }
  }

  if (!passwordOk) {
    if (email) {
      await recordLoginFailure(env, email).catch((err) =>
        log(env, "LOGIN_FAILURE_RECORD_FAILED", { internal: err?.message || String(err) })
      );
    }
    return json({ ok: false, error: "البريد أو كلمة المرور غير صحيحة." }, 401);
  }

  if (await isAccountDisabled(env, account.merchant_id)) return json({ ok: false, error: "هذا الحساب معطّل. تواصل مع فريق هالة." }, 403);

  await clearLoginAttempts(env, email).catch(() => {});

  const storeName = await getStoreName(env, account.merchant_id);
  const adminEmails = (env?.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const isAdmin = adminEmails.includes(email.toLowerCase());
  const token = await createSessionToken(env, account.merchant_id);
  return json({ ok: true, storeId: account.merchant_id, email, storeName: storeName ?? "أورا للتسويق", isAdmin }, 200, { "Set-Cookie": sessionCookieHeader(token) });
}

export const onRequestPost = withApi(loginHandler);

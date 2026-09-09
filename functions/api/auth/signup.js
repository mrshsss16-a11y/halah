// POST /api/auth/signup — body: { email, password, storeName? }
// Creates a merchant + account, sets the session cookie. One step, two
// fields — minimum friction (Commitment & Consistency: small first ask).
//
// المرحلة ٤: تنسيق فقط — كل SQL بـ`domain/accounts.js`، وبوابة CSRF من withApi.
// نفس الرسائل والحالات حرفياً (api.test.mjs وموجة الأمن تثبّتها).
import { withApi, json } from "../../_lib/core/respond.js";
import { hashPassword } from "../../_lib/core/auth.js";
import { createSessionToken, sessionCookieHeader } from "../../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { sanitizeInput, EMAIL_RE } from "../../_lib/core/security.js";
import { adminEmailList, isAdminEmail } from "../../_lib/core/adminEmails.js";
import { trialSeatUsage, createAccountWithMerchant } from "../../_lib/domain/accounts.js";
import { logError } from "../../_lib/core/errorLog.js";

// سقف تسجيلات التجربة (docs/ROADMAP.md m2.2.5): سعة AI المجانية خلف كل تاجر
// مشتركة لا لكل متجر — ١٥-٢٠ متجراً نشطاً هي السقف الحقيقي. الأدمن لا يُحتسب.
const TRIAL_MERCHANT_CAP = 20;

async function signupHandler(body, env, request, requestId, context) {
  // Cap signups per IP — the 20-seat trial cap otherwise doubles as a lockout
  // DoS (20 scripted POSTs fill every seat) (SECURITY_AUDIT C2/H10).
  const rl = await checkRateLimit(env, clientIp(request), "signup", 3, 3600, { failClosed: true });
  if (!rl.allowed) {
    return json({ ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" }, 429);
  }

  const email = (body.email || "").toString().trim().toLowerCase().slice(0, 200);
  const password = (body.password || "").toString();
  // Sanitize store name at the source: it renders in the admin accounts table
  // (SECURITY_AUDIT C3 stored XSS). Escaping at the sink is the primary fix.
  const storeName = sanitizeInput((body.storeName || "").toString().trim(), 100) || null;

  if (!EMAIL_RE.test(email)) return json({ ok: false, error: "أدخل بريد إلكتروني صحيح." }, 400);
  if (password.length < 8) {
    return json({ ok: false, error: "كلمة المرور لازم تكون ٨ أحرف على الأقل." }, 400);
  }

  // P38 — self-service signup must never mint an ADMIN_EMAILS address:
  // requireAdmin() matches accounts.email against that secret, so such a row IS
  // full admin. Same generic message + status as "email already taken" so this
  // endpoint can't be used to enumerate which addresses are admin.
  if (isAdminEmail(env, email)) {
    return json({ ok: false, error: "هذا البريد مسجّل مسبقاً — سجّل دخول بدل ذلك." }, 409);
  }

  let seats;
  try {
    seats = await trialSeatUsage(env, email, adminEmailList(env));
  } catch (err) {
    // Fail closed: an unreadable accounts table is not "zero accounts".
    try {
      logError(context, { requestId, path: "/api/auth/signup", code: "SIGNUP_SEAT_LOOKUP_FAILED", internal: String(err?.message || err) });
    } catch {
      // نفس الـDB المعطوب هو سبب الخطأ — لا نُسقط الرد بسببه.
    }
    return json({ ok: false, error: "تعذر إنشاء الحساب حالياً. حاول بعد قليل.", code: "SEAT_LOOKUP_FAILED" }, 503);
  }

  if (seats.duplicate) {
    return json({ ok: false, error: "هذا البريد مسجّل مسبقاً — سجّل دخول بدل ذلك." }, 409);
  }
  if (seats.count >= TRIAL_MERCHANT_CAP) {
    return json(
      { ok: false, error: "خلصت مقاعد التجربة المجانية حالياً — تواصل معنا وبنسجلك بأول مقعد يفتح.", code: "TRIAL_FULL" },
      403
    );
  }

  const merchantId = `m_${crypto.randomUUID().slice(0, 12)}`;
  const { hash, salt } = await hashPassword(password);
  await createAccountWithMerchant(env, { merchantId, storeName, email, hash, salt });

  const token = await createSessionToken(env, merchantId);
  return json({ ok: true, storeId: merchantId, email }, 200, { "Set-Cookie": sessionCookieHeader(token) });
}

export const onRequestPost = withApi(signupHandler);

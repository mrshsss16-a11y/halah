// POST /api/auth/google — Google Sign-In. الهوية تُؤخذ من رد جوجل وحده، لا من
// أي حقل يرسله العميل (وإلا فهو تجاوز مصادقة كامل).
// P41: ندخل فقط لحساب أنشأته جوجل (`m_g_…`) — لا ربط تلقائي لحساب كلمة مرور،
// وفشل القراءة غموضٌ يرفض (٥٠٣). P38: فرع الإنشاء يرفض عناوين ADMIN_EMAILS.
// الرفضان برسالة واحدة فلا يصير الطرف عرّافاً.
import { withApi, json } from "../../_lib/core/respond.js";
import { createSessionToken, sessionCookieHeader } from "../../_lib/core/session.js";
import { sanitizeInput } from "../../_lib/core/security.js";
import { hashPassword } from "../../_lib/core/auth.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { adminEmailList, isAdminEmail } from "../../_lib/core/adminEmails.js";
import { lookupAccountForGoogle, trialSeatUsage, provisionGoogleAccount } from "../../_lib/domain/accounts.js";
import { verifyGoogleIdToken } from "../../_lib/domain/auth.js";
import { logError } from "../../_lib/core/errorLog.js";

const EXISTING_ACCOUNT_MSG =
  "هذا البريد مسجّل مسبقاً بحساب كلمة مرور — سجّل الدخول بكلمة المرور، وإذا نسيتها استخدم «نسيت كلمة المرور».";
const REFUSED = [{ ok: false, error: EXISTING_ACCOUNT_MSG, code: "PASSWORD_ACCOUNT_EXISTS" }, 409];
const TRIAL_MERCHANT_CAP = 20;

async function googleAuthHandler(body, env, request, requestId, context) {
  const rl = await checkRateLimit(env, clientIp(request), "google_auth", 10, 60, { failClosed: true });
  if (!rl.allowed) return json({ ok: false, error: `محاولات كثيرة جداً. حاول بعد ${rl.resetInSeconds} ثانية.` }, 429);
  if (!env?.GOOGLE_CLIENT_ID) return json({ ok: false, error: "تسجيل الدخول بجوجل غير مفعّل حالياً.", code: "GOOGLE_NOT_CONFIGURED" }, 503);

  const credential = (body?.credential || "").toString();
  if (!credential) return json({ ok: false, error: "بيانات اعتماد جوجل مفقودة." }, 400);
  const identity = await verifyGoogleIdToken(env, credential).catch(() => null);
  if (!identity) return json({ ok: false, error: "تعذر التحقق من حساب جوجل." }, 401);

  const log = (code, extra) => logError(context, { requestId, path: "/api/auth/google", code, ...extra });
  const email = sanitizeInput(identity.email, 200);
  const name = sanitizeInput(identity.name || "تاجر أورا", 100);
  let merchantId = `m_g_${identity.sub.slice(0, 16)}`;

  if (env?.DB) {
    let account;
    try {
      account = await lookupAccountForGoogle(env, email);
    } catch (err) {
      log("GOOGLE_ACCOUNT_LOOKUP_FAILED", { internal: String(err?.message || err) });
      return json({ ok: false, error: "تعذر التحقق من الحساب حالياً. حاول بعد قليل.", code: "ACCOUNT_LOOKUP_FAILED" }, 503);
    }

    if (account.exists && !account.isGoogleAccount) {
      log("GOOGLE_LINK_REFUSED_PASSWORD_ACCOUNT", { internal: "refused: an unverified password account holds this address (P41)", storeId: account.merchantId });
      return json(...REFUSED);
    }
    if (account.exists) {
      merchantId = account.merchantId;
    } else if (isAdminEmail(env, email)) {
      return json(...REFUSED);
    } else {
      // P59/G4 — هذا الفرع **ينشئ** حساباً فيلزمه مقعد تجربة تماماً كـsignup.js
      // (بلا تطبيع بريد: العنوان متحقَّق من جوجل وهي ترفض حسابين بنقطة/`+tag`).
      let seats;
      try {
        seats = await trialSeatUsage(env, "", adminEmailList(env));
      } catch (err) {
        log("GOOGLE_SEAT_LOOKUP_FAILED", { internal: String(err?.message || err) });
        return json({ ok: false, error: "تعذر إنشاء الحساب حالياً. حاول بعد قليل.", code: "SEAT_LOOKUP_FAILED" }, 503);
      }
      if (seats.count >= TRIAL_MERCHANT_CAP) return json({ ok: false, error: "خلصت مقاعد التجربة المجانية حالياً — تواصل معنا وبنسجلك بأول مقعد يفتح.", code: "TRIAL_FULL" }, 403);
      // كلمة مرور عشوائية غير قابلة للاستخدام — هذا الحساب يدخل بجوجل.
      const rnd = new Uint8Array(32);
      crypto.getRandomValues(rnd);
      const { hash, salt } = await hashPassword(Array.from(rnd, (b) => b.toString(16).padStart(2, "0")).join(""));
      await provisionGoogleAccount(env, { merchantId, name, email, hash, salt });
    }
  }

  const token = await createSessionToken(env, merchantId);
  return json({ ok: true, storeId: merchantId, email, storeName: name, isAdmin: isAdminEmail(env, email) }, 200, { "Set-Cookie": sessionCookieHeader(token) });
}

export const onRequestPost = withApi(googleAuthHandler);

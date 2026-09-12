// POST /api/auth/reset_password — body: { token, newPassword } — يعيّن كلمة مرور برابط البريد.
//
// الأمن: التوكن يُستهلك ذرّياً (استخدام واحد، ٣٠ دقيقة)، والبريد يُقرأ من صف D1 لا من
// العميل. كل حالات الفشل برسالة واحدة. النجاح يرفع نسخة الجلسة فتموت كل الجلسات
// القديمة (P40) ويمسح قفل تسجيل الدخول.
import { withApi, json } from "../../_lib/core/respond.js";
import { hashPassword } from "../../_lib/core/auth.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { logError } from "../../_lib/core/errorLog.js";
import { bumpSessionVersion } from "../../_lib/core/session.js";
import { findMerchantIdByEmail } from "../../_lib/domain/accounts.js";
import { clearLoginAttempts } from "../../_lib/domain/auth.js";
import { consumeResetToken, setAccountPassword } from "../../_lib/domain/passwordReset.js";

const PATH = "/api/auth/reset_password";

async function resetPasswordHandler(body, env, request, requestId, context) {
  const rl = await checkRateLimit(env, clientIp(request), "reset_password", 10, 60, { failClosed: true });
  if (!rl.allowed) return json({ ok: false, error: `محاولات كثيرة جداً. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" }, 429);

  const log = (code, extra = {}) => logError(context, { requestId, path: PATH, code, ...extra });
  const token = (body?.token || "").toString().trim();
  const newPassword = (body?.newPassword || "").toString();

  if (!token || !newPassword) return json({ ok: false, error: "يرجى ملء كافة البيانات المطلوبة." }, 400);
  if (newPassword.length < 8 || newPassword.length > 200) return json({ ok: false, error: "كلمة المرور الجديدة يجب أن تكون بين 8 و200 خانة." }, 400);
  if (!env?.DB) return json({ ok: false, error: "الخدمة غير متاحة حالياً." }, 503);

  let email;
  try {
    email = await consumeResetToken(env, token);
  } catch (err) {
    log("RESET_TOKEN_CONSUME_FAILED", { internal: err?.message });
    return json({ ok: false, error: "الخدمة غير متاحة حالياً." }, 503);
  }
  if (!email) return json({ ok: false, error: "رابط الاستعادة غير صالح أو منتهي الصلاحية. اطلب رابطاً جديداً.", code: "RESET_LINK_INVALID" }, 400);

  const owner = await findMerchantIdByEmail(env, email).catch(() => null);
  const { hash, salt } = await hashPassword(newPassword);
  const written = owner && await setAccountPassword(env, { merchantId: owner, hash, salt }).catch((err) => {
    log("RESET_PASSWORD_WRITE_FAILED", { storeId: owner, internal: err?.message });
    return false;
  });
  if (!written) return json({ ok: false, error: "تعذّر تحديث كلمة المرور. اطلب رابطاً جديداً وحاول مرة أخرى." }, 500);

  await bumpSessionVersion(env, owner).catch((e) => log("SESSION_BUMP_FAILED", { storeId: owner, internal: e?.message }));
  await clearLoginAttempts(env, email).catch((e) => log("RESET_LOGIN_ATTEMPTS_CLEAR_FAILED", { internal: e?.message }));

  return json({ ok: true, message: "تم تحديث كلمة المرور. سُجّل خروجك من كل الأجهزة — سجّل دخولك بكلمة المرور الجديدة." });
}

export const onRequestPost = withApi(resetPasswordHandler);

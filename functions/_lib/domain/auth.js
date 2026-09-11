// مجال المصادقة: أقفال المحاولات (تسجيل الدخول + رمز استعادة كلمة المرور).
// نُقل من core/db.js بالمرحلة ٣ (docs/ARCHITECTURE.md §٢) بلا أي تغيير سلوكي —
// نفس جدول `login_attempts`، نفس SQL حرفياً، نفس العتبات والنوافذ.
//
// كان بالملف الأصلي خوارزميتان متوازيتان على الجدول نفسه؛ وُحّدتا هنا بمصنع
// واحد `attemptGuard({ prefix, policy })` يشترك بمشتقّ المفتاح وقراءة العدّاد
// والتصفير، ويُبقي **سياسة القفل** لكل مسار كما كانت بالضبط (لا توحيد سلوك):
//   • policy "lockout" (تسجيل الدخول): زيادة غير مشروطة، ثم ختم `locked_until`
//     وتصفير العدّاد عند بلوغ العتبة. القفل يُقرأ من `locked_until`.
//   • policy "window"  (رمز الاستعادة): الزيادة مشروطة بالنافذة (صفّ قديم =
//     محاولة أولى)، والقفل = عدّاد داخل النافذة بلغ العتبة، ويُحرَق الرمز.

import { sendWaText, waConfigured } from "../integrations/whatsapp.js";
import { isConfigured as emailConfigured, send as sendEmail } from "../integrations/email.js";

const ATTEMPT_THRESHOLD = 5;
const ATTEMPT_MINUTES = 15;

/**
 * @param {{prefix?: string, policy: "lockout"|"window"}} spec
 * @returns {{key(email:string):string, isLocked(env,email):Promise<boolean>,
 *            recordFailure(env,email):Promise<boolean>, clear(env,email):Promise<void>}}
 */
export function attemptGuard({ prefix = "", policy }) {
  const key = (email) => `${prefix}${email}`;

  /** عدّاد الفشل الخام للمفتاح (بلا شرط نافذة) — مشترك بين السياستين. */
  async function failedCount(env, k) {
    const row = await env.DB.prepare("SELECT failed_count FROM login_attempts WHERE email = ?")
      .bind(k)
      .first();
    return row?.failed_count ?? 0;
  }

  return {
    key,

    async isLocked(env, email) {
      const k = key(email);
      if (policy === "lockout") {
        const row = await env.DB.prepare("SELECT locked_until FROM login_attempts WHERE email = ?")
          .bind(k)
          .first();
        if (!row || !row.locked_until) return false;
        return new Date(row.locked_until + "Z").getTime() > Date.now();
      }
      // policy === "window" — العدّاد يعيش بعمر النافذة فقط: صفّ أقدم منها
      // يُعامَل كصفر محاولات، فالمستخدم المقفول يطلب رمزاً جديداً بعد انقضائها.
      // ATTEMPT_MINUTES ثابت بالكود لا مدخل مستخدم — آمن داخل datetime()
      // (D1 لا يدعم ربط معاملات داخل مُعدِّل datetime).
      const row = await env.DB.prepare(
        `SELECT failed_count FROM login_attempts
          WHERE email = ? AND updated_at > datetime('now', '-' || ? || ' minutes')`
      )
        .bind(k, ATTEMPT_MINUTES)
        .first();
      return (row?.failed_count ?? 0) >= ATTEMPT_THRESHOLD;
    },

    /** @returns {Promise<boolean>} true لو بلغت هذه المحاولة العتبة (قفل/حرق). */
    async recordFailure(env, email) {
      const k = key(email);
      if (policy === "lockout") {
        await env.DB.prepare(
          `INSERT INTO login_attempts (email, failed_count, updated_at)
     VALUES (?, 1, datetime('now'))
     ON CONFLICT (email) DO UPDATE SET
       failed_count = failed_count + 1,
       updated_at = datetime('now')`
        )
          .bind(k)
          .run();

        if ((await failedCount(env, k)) >= ATTEMPT_THRESHOLD) {
          // ATTEMPT_MINUTES ثابت بالكود لا مدخل مستخدم — آمن داخل مُعدِّل
          // datetime() (D1 لا يدعم ربط معاملات داخله).
          await env.DB.prepare(
            `UPDATE login_attempts SET locked_until = datetime('now', '+' || ? || ' minutes'), failed_count = 0
       WHERE email = ?`
          )
            .bind(ATTEMPT_MINUTES, k)
            .run();
          return true;
        }
        return false;
      }

      await env.DB.prepare(
        `INSERT INTO login_attempts (email, failed_count, updated_at)
     VALUES (?, 1, datetime('now'))
     ON CONFLICT (email) DO UPDATE SET
       failed_count = CASE
         WHEN login_attempts.updated_at > datetime('now', '-' || ? || ' minutes')
         THEN login_attempts.failed_count + 1
         ELSE 1
       END,
       updated_at = datetime('now')`
      )
        .bind(k, ATTEMPT_MINUTES)
        .run();

      return (await failedCount(env, k)) >= ATTEMPT_THRESHOLD;
    },

    async clear(env, email) {
      await env.DB.prepare("DELETE FROM login_attempts WHERE email = ?").bind(key(email)).run();
    }
  };
}

// ── قفل تسجيل الدخول (brute-force) ──────────────────────────────────────────
const loginGuard = attemptGuard({ policy: "lockout" });

/** Returns true if this email is currently locked out from login attempts. */
export async function isLoginLocked(env, email) {
  return loginGuard.isLocked(env, email);
}

/** Records a failed login attempt; locks the email out after 5 failures. */
export async function recordLoginFailure(env, email) {
  await loginGuard.recordFailure(env, email);
}

/** Clears failed-attempt state on successful login. */
export async function clearLoginAttempts(env, email) {
  await loginGuard.clear(env, email);
}

// ── قفل رمز استعادة كلمة المرور (P39) ───────────────────────────────────────
//
// الرمز ٦ خانات بنافذة ١٥ دقيقة و10^6 احتمال فقط، فمهاجم يجرّب بحرية يخمّنه.
// الحارس الوحيد كان checkRateLimit لكل IP، وهو يفشل **مفتوحاً** عند سقوط KV
// ويُهزَم بتدوير الـIP.
//
// نستخدم جدول `login_attempts` نفسه لا جدولاً جديداً: المفتاح موسوم ببادئة
// `pwreset:` فقفل الاستعادة لا يقفل الدخول (ولا العكس — وهو مقصد التدفق كله).
//
// كل دالة هنا **ترمي** عند خطأ D1 عمداً؛ على المستدعي أن يفشل **مغلقاً**
// (يرفض الاستعادة) لا أن يبتلع الخطأ فيمرّر التخمين.
const resetGuard = attemptGuard({ prefix: "pwreset:", policy: "window" });

/** True if this email has burned through its OTP guesses. Throws if the DB is unreachable. */
export async function isResetOtpLocked(env, email) {
  return resetGuard.isLocked(env, email);
}

/**
 * Records one failed OTP entry. On the 5th failure it BURNS the pending OTP
 * (deletes the password_resets row) so even the correct code is dead
 * afterwards — the user must request a fresh one.
 * Returns true if the code was burned by this call. Throws on a DB error.
 */
export async function recordResetOtpFailure(env, email) {
  const reached = await resetGuard.recordFailure(env, email);
  if (reached) {
    await env.DB.prepare("DELETE FROM password_resets WHERE email = ?").bind(email).run();
    return true;
  }
  return false;
}

/** Clears the OTP failure counter (successful reset, or a freshly issued code). */
export async function clearResetOtpAttempts(env, email) {
  await resetGuard.clear(env, email);
}

// ── المرحلة ٤ (docs/ARCHITECTURE.md §٢): SQL كان بـ`functions/api/auth/*` ──
// نقل حرفي: نفس الجداول والشروط والنوافذ. لا رسالة عميل ولا حالة تتغيّر —
// الترجمة لـHTTP تبقى بنقطة الدخول، والمجال يعيد بيانات أو يرمي.

/**
 * يسجّل (أو يستبدل) رمز استعادة كلمة المرور المُجزّأ بنافذة ١٥ دقيقة.
 * ابتلاع الخطأ مقصود ومنقول كما كان: الرد للعميل موحّد بأي حال (منع التعداد).
 */
export async function issuePasswordReset(env, { email, otpHash }) {
  // secret-plaintext-ok: `reset_token` عمود أثري من تصميم «رابط استعادة» لم
  // يُنفَّذ — يُكتب سلسلة فارغة دائماً ولا يُقرأ إطلاقاً، فلا سرّ فيه ليُشفَّر.
  // السرّ الفعلي هنا `otp_code` ويُخزَّن **مجزَّأً** (otpHash) لا مشفَّراً:
  // التجزئة أقوى — لا مسار لاستعادة الرمز حتى بمفتاح التشفير.
  await env.DB.prepare(
    `INSERT INTO password_resets (email, otp_code, reset_token, expires_at)
     VALUES (?, ?, ?, datetime('now', '+15 minutes'))
     ON CONFLICT (email) DO UPDATE SET
       otp_code = excluded.otp_code,
       reset_token = excluded.reset_token,
       expires_at = excluded.expires_at`
  )
    .bind(email, otpHash, "")
    .run()
    .catch(() => {});
}

/** تجزئة الرمز السارية لهذا البريد (أو null: لا طلب/منتهٍ/عطل D1). */
export async function pendingResetOtpHash(env, email) {
  const row = await env.DB.prepare(
    "SELECT otp_code FROM password_resets WHERE email = ? AND expires_at > datetime('now')"
  )
    .bind(email)
    .first()
    .catch(() => null);
  return row?.otp_code || null;
}

/**
 * قناة تسليم الرمز: آخر رقم واتساب تواصل مع هذا التاجر. لا مزوّد بريد مضبوط
 * لاستعادة كلمة المرور، ولا رقم مفبرك — غيابه يعني «لم يُسلَّم» (§١١ الصدق).
 */
// المرحلة ٦: لم تعد مصدَّرة — كان الـshim `core/db.js` (المحذوف) يعيد تصديرها
// بلا مستورد واحد. تُستخدم داخل هذا الملف فقط؛ لا سطح تعديل زائف (لا كود ميت).
async function resetDeliveryPhone(env, merchantId) {
  const row = await env.DB.prepare(
    "SELECT phone FROM whatsapp_contacts WHERE merchant_id = ? ORDER BY last_inbound_at DESC LIMIT 1"
  )
    .bind(merchantId)
    .first()
    .catch(() => null);
  return row?.phone || null;
}

/**
 * يكتب كلمة المرور الجديدة. يعيد false لو فشلت الكتابة (المستدعي يرد ٥٠٠).
 * tenant-audit-ok: الرمز المتحقَّق منه هو ما يثبت الملكية، لا شرط merchant_id.
 */
export async function setPasswordForEmail(env, { email, hash, salt }) {
  // tenant-audit-ok: إعادة تعيين كلمة المرور مفتاحها البريد المتحقَّق برمز OTP —
  // فحص الرمز (timingSafeEqual) هو ما يثبت الملكية، لا شرط merchant_id.
  const update = await env.DB.prepare(
    "UPDATE accounts SET password_hash = ?, password_salt = ? WHERE email = ?"
  )
    .bind(hash, salt, email)
    .run()
    .catch(() => null);
  return Boolean(update);
}

/** يحرق رمز الاستعادة (استخدام واحد). يرمي عند الفشل ليُسجَّل بالمستدعي. */
export async function consumePasswordReset(env, email) {
  await env.DB.prepare("DELETE FROM password_resets WHERE email = ?").bind(email).run();
}

// ── تحقق ملكية البريد (`email_verifications`) ───────────────────────────────

/** بريد الحساب وحالة تحقّقه — الأساس لكل من إرسال الرمز والتحقق منه. */
export async function accountVerificationState(env, merchantId) {
  return env.DB.prepare("SELECT email, email_verified_at FROM accounts WHERE merchant_id = ?")
    .bind(merchantId)
    .first();
}

/** يخزّن رمز تحقق جديد مُجزّأ (١٥ دقيقة، العدّاد يعود صفراً). */
export async function createEmailVerification(env, { email, codeHash }) {
  await env.DB.prepare(
    `INSERT INTO email_verifications (email, code_hash, attempts, expires_at)
     VALUES (?, ?, 0, datetime('now', '+15 minutes'))
     ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at, created_at = datetime('now')`
  )
    .bind(email, codeHash)
    .run();
}

/**
 * يعدّ المحاولة **قبل** القراءة بنفس الصف (UPDATE … RETURNING) — لا سباق بين
 * طلبين متوازيين. يعيد null لو لا صف/منتهٍ (يُعامَل كرمز خاطئ بلا تمييز).
 * tenant-audit-ok: `email` هو بريد حساب الجلسة (قُرئ بشرط merchant_id).
 */
export async function consumeEmailVerification(env, email) {
  return env.DB.prepare(
    `UPDATE email_verifications SET attempts = attempts + 1
      WHERE email = ? AND expires_at > datetime('now')
      RETURNING code_hash, attempts`
  )
    .bind(email)
    .first();
}

/** يحرق رمز التحقق (تجاوز المحاولات). الابتلاع منقول كما كان. */
export async function burnEmailVerification(env, email) {
  await env.DB.prepare("DELETE FROM email_verifications WHERE email = ?").bind(email).run().catch(() => {});
}

/** يختم البريد متحقَّقاً ويحذف الرمز بدفعة واحدة. */
export async function markEmailVerified(env, { merchantId, email }) {
  await env.DB.batch([
    env.DB.prepare("UPDATE accounts SET email_verified_at = datetime('now') WHERE merchant_id = ?").bind(merchantId),
    env.DB.prepare("DELETE FROM email_verifications WHERE email = ?").bind(email)
  ]);
}

/** تجزئة رمز تحقق البريد (SHA-256 مع البريد) — مصدر واحد للإرسال والتحقق. */
export async function hashVerificationCode(email, code) {
  const data = new TextEncoder().encode(`verify:${email}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── تحقق هوية Google Sign-In ────────────────────────────────────────────────
// الهوية تُؤخذ من رد جوجل وحده. الجمهور (`aud`) مثبَّت على GOOGLE_CLIENT_ID
// فتوكن صُكّ لتطبيق آخر لا يُعاد لعبه هنا، والبريد غير المتحقَّق مرفوض.
const GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo?id_token=";

/** @returns {Promise<{email:string,name:string,sub:string}|null>} */
export async function verifyGoogleIdToken(env, credential) {
  const res = await fetch(`${GOOGLE_TOKENINFO_URL}${encodeURIComponent(credential)}`);
  if (!res.ok) return null;
  const info = await res.json().catch(() => null);
  if (!info?.email) return null;
  if (!env?.GOOGLE_CLIENT_ID || info.aud !== env.GOOGLE_CLIENT_ID) return null;
  if (info.email_verified !== "true" && info.email_verified !== true) return null;
  return { email: String(info.email).toLowerCase(), name: info.name || "", sub: String(info.sub || "") };
}

// ── المرحلة ٦ (ق٦): `api/**` لا يستورد `integrations/**` ────────────────────
/**
 * تسليم رمز استعادة كلمة المرور خارج النطاق: **البريد أولاً**، وواتساب
 * احتياطاً لمن ربط رقمه. غياب القناتين معاً ⇒ `false` (ونقطة النهاية تسجّل
 * ذلك ولا تدّعي إرسالاً لم يحدث — §١١ الصدق).
 * @returns {Promise<boolean>} هل خرجت الرسالة فعلاً؟
 */
export async function deliverResetOtp(env, merchantId, otpCode, email = null) {
  // البريد أولاً: هو الهوية التي كتبها التاجر بالنموذج، والقناة الوحيدة
  // المضمونة لكل حساب. كان واتساب القناة الوحيدة، وهي تشترط أن يكون التاجر
  // **راسل متجره من واتساب** من قبل (صفّ بـ`whatsapp_contacts`) — شرطٌ لا
  // يتحقق أبداً لمن سجّل ببريده ولم يربط واتساب، فكانت استعادة كلمة المرور
  // مستحيلة عليه **بصمت** (رُصد 2026-09-10). واتساب يبقى احتياطاً لا بديلاً.
  if (email && emailConfigured(env)) {
    const sent = await sendEmail(env, {
      to: email,
      subject: "رمز استعادة كلمة المرور — هالة",
      text: `رمز استعادة كلمة المرور: ${otpCode}\nصالح ١٥ دقيقة. لا تشاركه مع أحد.`
    })
      .then(() => true)
      .catch(() => false);
    if (sent) return true;
  }
  if (!waConfigured(env)) return false;
  const phone = await resetDeliveryPhone(env, merchantId);
  if (!phone) return false;
  return sendWaText(env, {
    to: phone,
    body: `رمز استعادة كلمة المرور: ${otpCode}\nصالح ١٥ دقيقة. لا تشاركه مع أحد.`
  })
    .then(() => true)
    .catch(() => false);
}

/** هل مزوّد البريد مضبوط؟ غيابه ⇒ ٥٠٣ صريحة، لا ادّعاء إرسال. */
export function verificationChannelReady(env) {
  return emailConfigured(env);
}

/** إرسال رمز تحقق البريد. يرمي عند الفشل — نقطة النهاية تترجمه إلى ٥٠٢. */
export async function deliverVerificationCode(env, { email, code }) {
  return sendEmail(env, {
    to: email,
    subject: "رمز تأكيد بريدك — هالة",
    text: `رمز تأكيد بريدك: ${code}\nصالح ١٥ دقيقة. لا تشاركه مع أحد.`
  });
}

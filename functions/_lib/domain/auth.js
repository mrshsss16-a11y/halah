// مجال المصادقة: قفل محاولات تسجيل الدخول، تحقق ملكية البريد، وتحقق Google.
// استعادة كلمة المرور انتقلت لـ`domain/passwordReset.js` (رابط بالبريد بتوكن ٢٥٦ بت
// بدل رمز ٦ أرقام) — فحُذفت سياسة "window" وعدّاد `pwreset:` معها.

import { isConfigured as emailConfigured, send as sendEmail } from "../integrations/email.js";

const ATTEMPT_THRESHOLD = 5;
const ATTEMPT_MINUTES = 15;

/**
 * @param {{prefix?: string, policy: "lockout"}} spec
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
      return false;
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
      return false;
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

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

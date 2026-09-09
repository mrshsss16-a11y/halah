// مجال الحسابات والتجّار: صف `merchants` الأساسي، جدول `accounts`،
// تطبيع البريد ومحاسبة مقاعد التجربة، وربط حساب جوجل.
// نُقل من core/db.js بالمرحلة ٣ (docs/ARCHITECTURE.md §٢) بلا تغيير سلوكي.
//
// المرحلة ٦: `getMerchant` و`getAccountEmail` انتقلا إلى `core/identity.js`
// (قراءة صف بمفتاحه، صفر منطق) لأن `core/session.js` يحتاجهما ولا يجوز لـcore
// أن يستورد domain (ق١). استوردهما من هناك. أما البحث/الإنشاء بمعرّف سلة
// (`getMerchantBySalla` · `upsertMerchantFromSalla`) فهما بـdomain/salla.js
// لأنهما جزء من تدفق OAuth الخاص بالمنصة.


export async function listAccounts(env, limit = 200) {
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  let rows = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT
        a.merchant_id,
        a.email,
        a.created_at,
        a.disabled,
        m.store_name,
        COALESCE(u.credits_used, 0) as credits_used
       FROM accounts a
       LEFT JOIN merchants m ON a.merchant_id = m.id
       LEFT JOIN usage_meter u ON a.merchant_id = u.merchant_id AND u.day = ?
       ORDER BY a.created_at DESC LIMIT ?`
    )
      .bind(todayStr, limit)
      .all();
    rows = results || [];
  } catch (err) {
    const { results } = await env.DB.prepare(
      "SELECT merchant_id, email, created_at, disabled FROM accounts ORDER BY created_at DESC LIMIT ?"
    )
      .bind(limit)
      .all();
    rows = results || [];
  }

  return rows.map((r) => ({
    merchantId: r.merchant_id,
    email: r.email,
    storeName: r.store_name ?? "متجر غير معنون",
    createdAt: r.created_at,
    disabled: Boolean(r.disabled),
    creditsUsed: r.credits_used ?? 0,
    dailyLimit: 50
  }));
}

export async function setAccountDisabled(env, merchantId, disabled) {
  await env.DB.prepare("UPDATE accounts SET disabled = ? WHERE merchant_id = ?")
    .bind(disabled ? 1 : 0, merchantId)
    .run();
}

export async function isAccountDisabled(env, merchantId) {
  const row = await env.DB.prepare("SELECT disabled FROM accounts WHERE merchant_id = ?")
    .bind(merchantId)
    .first();
  return Boolean(row && row.disabled);
}

// ── P41: which auth method created this account? ──
//
// Nothing in this project verifies that a signup address belongs to the person
// signing up (there is no `email_verified` column). So a password account is an
// UNPROVEN claim on an address: anyone can POST /api/auth/signup with a
// stranger's email. Auto-linking a later Google sign-in to that row would hand
// the attacker a shared account with the real owner (pre-hijack).
//
// The account's own merchant_id records how it was created, and always has:
//   • google.js  → `m_g_<google sub>`            (GOOGLE_MERCHANT_PREFIX)
//   • signup.js / db.js → `m_<uuid slice>`
// The `m_` ids are `m_` + the first 12 chars of crypto.randomUUID(), i.e. hex
// digits and `-` only — `g` is not a hex digit, so an `m_` id can never
// accidentally look like an `m_g_` id. That makes the prefix an exact, already
// -populated provider marker: no migration, no backfill, no column that the
// running code would have to read before it exists.
//
// THROWS on a DB error on purpose — the caller must fail closed (refuse the
// link) rather than treat an unreadable accounts table as "no account here".
export const GOOGLE_MERCHANT_PREFIX = "m_g_";

/**
 * @returns {Promise<{exists: boolean, merchantId: string|null, isGoogleAccount: boolean}>}
 */
export async function lookupAccountForGoogle(env, email) {
  const row = await env.DB.prepare("SELECT merchant_id FROM accounts WHERE email = ?")
    .bind(email)
    .first();
  const merchantId = row?.merchant_id ? String(row.merchant_id) : null;
  return {
    exists: Boolean(merchantId),
    merchantId,
    isGoogleAccount: Boolean(merchantId && merchantId.startsWith(GOOGLE_MERCHANT_PREFIX))
  };
}

// ── P59 (G4): تطبيع البريد + محاسبة مقاعد التجربة ──
//
// سقف التجربة (TRIAL_MERCHANT_CAP) يُحتسب بمطابقة نصية على `accounts.email`.
// هذا يجعله قابلاً للالتفاف بصيغ مختلفة لنفس الصندوق البريدي:
//   a+1@x.com · a+2@x.com …  → أي مزوّد يتجاهل ما بعد `+` بالجزء المحلي.
//   a.b@gmail.com = ab@gmail.com → **جيميل وحده** يتجاهل النقاط.
// تحقُّق تقني (2026-09-07، support.google.com/mail/answer/7436150): جوجل تنص
// صراحةً أن النقاط لا تغيّر عنوان @gmail.com، وتنص **بنفس الصفحة** أن نطاقات
// Workspace (yourdomain.com) النقاط فيها تُغيّر العنوان فعلاً. لذلك حذف النقاط
// مقصور على `gmail.com`/`googlemail.com` فقط — تعميمه على كل النطاقات يدمج
// عناوين لأشخاص مختلفين (مثلاً على Fastmail/Exchange) ويمنع تسجيلاً مشروعاً.
// `googlemail.com` هو نفس صندوق `gmail.com` فيُوحَّد للنطاق نفسه.
//
// ملاحظة مقصودة: التطبيع للمقارنة فقط — الصف يُخزَّن بالعنوان كما كتبه التاجر
// (بعد lowercase). تغيير المخزَّن كان سيكسر تسجيل الدخول، لأن `login.js` يبحث
// بالعنوان المُدخَل حرفياً.
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** الصيغة المعيارية للمقارنة فقط. لا تُخزَّن ولا تُعرض للمستخدم. */
export function normalizeEmailForDedupe(email) {
  const raw = String(email || "").trim().toLowerCase();
  const at = raw.lastIndexOf("@");
  if (at <= 0 || at === raw.length - 1) return raw;
  let local = raw.slice(0, at);
  let domain = raw.slice(at + 1);

  const plus = local.indexOf("+");
  // `plus > 0` عمداً: عنوان يبدأ بـ`+` جزؤه المحلي كله وسم — لا نُفرغه.
  if (plus > 0) local = local.slice(0, plus);

  if (GMAIL_DOMAINS.has(domain)) {
    domain = "gmail.com";
    local = local.split(".").join("");
  }

  return local ? `${local}@${domain}` : raw;
}

/**
 * محاسبة مقعد تجربة واحدة: كم حساباً غير أدمن موجود، وهل البريد المطلوب
 * (بصيغته المعيارية) مأخوذ مسبقاً بأي صيغة.
 *
 * يفشل مغلقاً: أي خطأ D1 يُرمى للمستدعي ليرفض الطلب، لا "تمرير برشاقة".
 *
 * @returns {Promise<{ count: number, duplicate: boolean }>}
 */
export async function trialSeatUsage(env, email, adminEmails = []) {
  const admins = new Set(adminEmails.map((a) => String(a || "").trim().toLowerCase()).filter(Boolean));
  const target = normalizeEmailForDedupe(email);

  // tenant-audit-ok: عدّ/مطابقة عابرة للمستأجرين عن قصد — سقف التجربة حدّ عام
  // على مجموع التسجيلات، ومطابقة البريد فحص تفرّد على عمود عام. الجدول محدود
  // بالسقف نفسه (٢٠ + حسابات الأدمن) فالمسح رخيص.
  const { results } = await env.DB.prepare("SELECT email FROM accounts").all();

  let count = 0;
  let duplicate = false;
  for (const row of results || []) {
    const stored = String(row?.email || "").trim().toLowerCase();
    if (!stored) continue;
    // المطابقة قبل استثناء الأدمن: صيغة معيارية تساوي عنوان أدمن (admin+x@…)
    // تُرفض كمكرّر بنفس رسالة «مسجّل مسبقاً» — لا تعداد ولا مقعد إضافي.
    if (target && normalizeEmailForDedupe(stored) === target) duplicate = true;
    if (admins.has(stored)) continue; // حسابات الأدمن لا تحتسب من المقاعد
    count += 1;
  }

  return { count, duplicate };
}

// ── المرحلة ٤ (docs/ARCHITECTURE.md §٢): SQL كان بـ`functions/api/auth/*` ──
// كل دالة هنا نقل حرفي للاستعلام كما كان بنقطة الدخول — نفس الجداول، نفس
// الشروط، نفس معالجة الأخطاء (الرمي يبقى رمياً، والابتلاع يبقى بالمستدعي).

/** صف الحساب كاملاً بالبريد — هوية ما قبل المصادقة. */
export async function findAccountByEmail(env, email) {
  // tenant-audit-ok: identity resolution pre-auth — email IS the lookup key,
  // there is no merchant_id to scope by until this query resolves one.
  return env.DB.prepare("SELECT * FROM accounts WHERE email = ?").bind(email).first();
}

/** معرّف التاجر المالك لهذا البريد (أو null) — بعد إثبات الملكية بالرمز. */
export async function findMerchantIdByEmail(env, email) {
  // tenant-audit-ok: email هو الهوية المُثبَتة بالرمز (OTP) — لا merchant_id قبلها.
  const row = await env.DB.prepare("SELECT merchant_id FROM accounts WHERE email = ?").bind(email).first();
  return row?.merchant_id || null;
}

/** هل يوجد صف `merchants` بهذا المعرّف — يُفشل مغلقاً بدل إنشاء حساب يتيم. */
export async function merchantExists(env, merchantId) {
  const row = await env.DB.prepare("SELECT id FROM merchants WHERE id = ?").bind(merchantId).first();
  return Boolean(row);
}

/** اسم المتجر فقط (لوحة الدخول وme). */
export async function getStoreName(env, merchantId) {
  const row = await env.DB.prepare("SELECT store_name FROM merchants WHERE id = ?").bind(merchantId).first();
  return row?.store_name ?? null;
}

/** هل لهذا التاجر حساب مكتمل مسبقاً (بريد + كلمة مرور)؟ */
export async function accountEmailFor(env, merchantId) {
  return env.DB.prepare("SELECT email FROM accounts WHERE merchant_id = ?").bind(merchantId).first();
}

/** هل البريد مأخوذ بأي متجر؟ */
export async function emailTaken(env, email) {
  // tenant-audit-ok: uniqueness check on the global email column — an email may
  // belong to at most one merchant, so this lookup is deliberately not scoped.
  const row = await env.DB.prepare("SELECT merchant_id FROM accounts WHERE email = ?").bind(email).first();
  return Boolean(row);
}

/** تسجيل جديد: صف متجر + صف حساب بدفعة واحدة (نفس batch الأصلي). */
export async function createAccountWithMerchant(env, { merchantId, storeName, email, hash, salt }) {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO merchants (id, store_name) VALUES (?, ?)").bind(merchantId, storeName),
    env.DB.prepare(
      "INSERT INTO accounts (merchant_id, email, password_hash, password_salt) VALUES (?, ?, ?, ?)"
    ).bind(merchantId, email, hash, salt)
  ]);
}

/** إكمال حساب متجر سلة قائم (المتجر موجود، الحساب لا). */
export async function completeAccount(env, { merchantId, email, hash, salt }) {
  await env.DB.prepare(
    "INSERT INTO accounts (merchant_id, email, password_hash, password_salt) VALUES (?, ?, ?, ?)"
  )
    .bind(merchantId, email, hash, salt)
    .run();
}

/**
 * أول دخول بجوجل: متجر + حساب بـ`INSERT OR IGNORE`. ابتلاع الخطأ مقصود ومنقول
 * كما هو من `api/auth/google.js` — سباق نافذتين متوازيتين ينتهي بصف واحد.
 */
export async function provisionGoogleAccount(env, { merchantId, name, email, hash, salt }) {
  await env.DB.prepare("INSERT OR IGNORE INTO merchants (id, store_name) VALUES (?, ?)")
    .bind(merchantId, name)
    .run()
    .catch(() => {});
  await env.DB.prepare(
    "INSERT OR IGNORE INTO accounts (merchant_id, email, password_hash, password_salt) VALUES (?, ?, ?, ?)"
  )
    .bind(merchantId, email, hash, salt)
    .run()
    .catch(() => {});
}

// ربط متجر سلة (جلسة Easy Mode بلا حساب) بحساب أُنشئ من موقعنا.
//
// لماذا وُجد (رُصد 2026-09-10): بـEasy Mode سلة تسلّم التوكن بويبهوك يحمل
// معرّف **المتجر** وحده، فيُنشأ صفّ تاجر للمتجر بلا بريد. من فتح هالة من داخل
// سلة يُعرض عليه «أنشئ حساباً» فقط. فإن كان عنده حساب من موقعنا أصلاً اصطدم بـ
// «هذا البريد مسجّل مسبقاً» بلا أي طريق لربط متجره بحسابه — والزر «اربط متجر
// سلة» من اللوحة لا يحلّها، لأن الويبهوك لا يعرف مَن كان مسجَّل دخوله.
//
// القاعدة: الحساب **ينتقل إلى صفّ المتجر** (لا العكس) — صفّ المتجر هو من يملك
// التوكن والمنتجات وكل ما سيُسحب لاحقاً بمعرّف سلة، فنقل الهوية أبسط وأسلم من
// نقل البيانات جدولاً جدولاً.
//
// ومتى يُرفض — نفس مبدأ «ارفض ووضّح» بـ`sallaAccountLink.js`:
//   - الحساب يملك متجراً آخر (معرّف سلة، أو توكن، أو منتجات): الدمج الصامت
//     يفقد بيانات أحد المتجرين. التاجر يفكّ الربط هناك أولاً بقرار منه.
//   - صفّ المتجر له حساب أصلاً: لا نستبدل صاحب متجر بآخر.
//
// كلمة المرور تمرّ بنفس قفل تسجيل الدخول (`login_attempts` بمفتاح البريد): هذي
// النقطة تتحقق من كلمة مرور، فبدون القفل تصير باباً جانبياً للتخمين.
import { verifyPassword } from "../core/auth.js";
import { bumpSessionVersion } from "../core/session.js";
import { isLoginLocked, recordLoginFailure, clearLoginAttempts } from "./auth.js";
import { findAccountByEmail, isAccountDisabled, GOOGLE_MERCHANT_PREFIX } from "./accounts.js";
import { purgeMerchantData } from "./merchantPurge.js";

/** رفض مصنَّف بحالة HTTP ورسالة عربية للتاجر — لا يكشف شيئاً عن صفّ آخر. */
export class ClaimError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ClaimError";
    this.status = status;
    this.code = code;
  }
}

const BAD_CREDENTIALS = () => new ClaimError(401, "BAD_CREDENTIALS", "البريد أو كلمة المرور غير صحيحة.");

/**
 * يربط صفّ المتجر `storeMerchantId` (من الجلسة فقط) بحساب البريد بعد التحقق
 * من كلمة مروره. يرجّع `{ merchantId }` = صفّ المتجر، وعلى المستدعي إصدار
 * كوكي جديد بعده (نسخة الجلسة تغيّرت). يرمي `ClaimError` عند كل رفض.
 */
export async function claimStoreWithAccount(env, { storeMerchantId, email, password }) {
  await assertClaimableStore(env, storeMerchantId);

  // ── إثبات ملكية الحساب — بنفس قفل تسجيل الدخول ─────────────────────────
  if (await isLoginLocked(env, email)) {
    throw new ClaimError(429, "LOCKED", "محاولات كثيرة فاشلة — الحساب مقفل مؤقتاً، حاول بعد ١٥ دقيقة.");
  }
  const account = await findAccountByEmail(env, email);
  const passwordOk = account
    ? await verifyPassword(password, account.password_hash, account.password_salt).catch(() => false)
    : false;
  if (!passwordOk) {
    await recordLoginFailure(env, email).catch(() => {});
    throw BAD_CREDENTIALS();
  }
  if (await isAccountDisabled(env, account.merchant_id)) {
    throw new ClaimError(403, "ACCOUNT_DISABLED", "هذا الحساب معطّل. تواصل مع فريق هالة.");
  }
  await clearLoginAttempts(env, email).catch(() => {});
  return transferAccountToStore(env, { storeMerchantId, account });
}

/**
 * نفس الربط لكن الملكية أثبتتها جوجل (`api/auth/salla_google.js`، 2026-09-14): يُقبل **حساب جوجل فقط**
 * (`m_g_…`) — حساب بكلمة مرور لا يُربط بجوجل تلقائياً (P41).
 */
export async function claimStoreWithGoogleAccount(env, { storeMerchantId, email }) {
  await assertClaimableStore(env, storeMerchantId);
  const account = await findAccountByEmail(env, email);
  if (!account || !String(account.merchant_id).startsWith(GOOGLE_MERCHANT_PREFIX)) {
    throw new ClaimError(409, "NOT_GOOGLE_ACCOUNT", "هذا البريد له حساب بكلمة مرور — ادخل بكلمة المرور ليُربط المتجر به.");
  }
  if (await isAccountDisabled(env, account.merchant_id)) {
    throw new ClaimError(403, "ACCOUNT_DISABLED", "هذا الحساب معطّل. تواصل مع فريق هالة.");
  }
  return transferAccountToStore(env, { storeMerchantId, account });
}

async function assertClaimableStore(env, storeMerchantId) {
  const store = await env.DB.prepare("SELECT id, salla_merchant_id FROM merchants WHERE id = ?")
    .bind(storeMerchantId)
    .first();
  if (!store) throw new ClaimError(404, "MERCHANT_NOT_FOUND", "المتجر غير موجود.");
  if (!store.salla_merchant_id) {
    throw new ClaimError(409, "NO_STORE", "ما فيه متجر سلة بهذي الجلسة لربطه. افتح هالة من لوحة متجرك: تطبيقاتي ← هالة.");
  }
  const storeHasAccount = await env.DB.prepare("SELECT 1 AS x FROM accounts WHERE merchant_id = ?")
    .bind(storeMerchantId)
    .first();
  if (storeHasAccount) throw new ClaimError(409, "ACCOUNT_EXISTS", "هذا المتجر مربوط بحساب مسبقاً.");
}

async function transferAccountToStore(env, { storeMerchantId, account }) {
  const from = account.merchant_id;

  // ── صفّ الحساب يجب أن يكون فارغاً من أي متجر ──────────────────────────
  const own = await env.DB.prepare(
    `SELECT m.salla_merchant_id AS s,
            (SELECT COUNT(*) FROM oauth_tokens t WHERE t.merchant_id = ?) AS t,
            (SELECT COUNT(*) FROM store_products p WHERE p.merchant_id = ?) AS p
       FROM merchants m WHERE m.id = ?`
  )
    .bind(from, from, from)
    .first();
  if (own && (own.s || Number(own.t) > 0 || Number(own.p) > 0)) {
    throw new ClaimError(
      409,
      "ACCOUNT_HAS_STORE",
      "حسابك مربوط بمتجر آخر. افتح لوحتك بذاك الحساب ← متجري ← «فكّ ربط سلة» أولاً، ثم ارجع هنا."
    );
  }

  // ── النقل ─────────────────────────────────────────────────────────────────
  // ١) أسقط جلسات الحساب القديمة وهو لا يزال على صفّه — بعد النقل لا صفّ يحمل
  //    رقمها تحت المعرّف القديم.
  await bumpSessionVersion(env, from).catch(() => null);
  // ٢) الحساب ينتقل لصفّ المتجر.
  await env.DB.prepare("UPDATE accounts SET merchant_id = ? WHERE merchant_id = ?")
    .bind(storeMerchantId, from)
    .run();
  // ٣) نسخة الجلسة على صفّ المتجر صارت نسخة الحساب المنقول، بينما مرآة KV
  //    لصفّ المتجر ما زالت تحمل القديمة: بلا هذا الرفع تبقى الجلسة صالحة حتى
  //    تنتهي المرآة (ساعة) ثم يُطرد التاجر بصمت. الرفع يكتب المرآة بالرقم
  //    الجديد، والمستدعي يصدر كوكياً عليه.
  await bumpSessionVersion(env, storeMerchantId);
  // ٤) صفّ الحساب القديم بلا متجر ولا حساب الآن — يُمحى أثره ثم الصفّ نفسه.
  await purgeMerchantData(env, from);
  await env.DB.prepare("DELETE FROM merchants WHERE id = ?").bind(from).run().catch(() => {});

  return { merchantId: storeMerchantId, email: account.email };
}

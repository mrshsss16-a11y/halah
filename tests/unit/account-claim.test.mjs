// ربط متجر سلة بحساب أُنشئ من الموقع — `domain/accountClaim.js` و`api/auth/claim_store.js`.
//
// رُصد 2026-09-10: بـEasy Mode لا طريق لربط حساب الموقع (salla-review@aura.sa)
// بمتجر — الويبهوك لا يعرف مَن كان مسجَّل دخوله، ونافذة «أكمل حسابك» كانت تعرض
// «إنشاء» فقط فترفض البريد المسجّل. هذي الاختبارات تحرس: إثبات الملكية بكلمة
// المرور وقفلها، رفض الدمج حين يملك الحساب متجراً، اتجاه النقل، وترتيب رفع نسخة
// الجلسة الذي بدونه يُطرد التاجر بصمت بعد ساعة.
import { readFileSync } from "node:fs";
import { createRunner } from "../_helpers.mjs";

const { assert, done } = createRunner("account-claim");
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

/** D1 وهمي موجَّه بالتعبير، يسجّل كل استعلام بالترتيب مع طريقة تنفيذه. */
function fakeDb(routes) {
  const log = [];
  const pick = (sql) => routes.find((r) => r.match.test(sql));
  return {
    log,
    prepare(sql) {
      const route = pick(sql);
      let args = [];
      const stmt = {
        bind(...a) { args = a; return stmt; },
        async first() {
          log.push({ sql, args, via: "first" });
          return typeof route?.first === "function" ? route.first(args) : (route?.first ?? null);
        },
        async run() {
          log.push({ sql, args, via: "run" });
          return { meta: { changes: 1 } };
        },
        async all() { return { results: [] }; }
      };
      return stmt;
    },
    async batch(stmts) { for (const s of stmts) await s.run(); return []; }
  };
}

async function main() {
  const { claimStoreWithAccount, ClaimError } = await import("../../functions/_lib/domain/accountClaim.js");
  const { hashPassword } = await import("../../functions/_lib/core/auth.js");
  const { hash, salt } = await hashPassword("correct-horse-9");

  /** بيئة كاملة: صفّ متجر مربوط بلا حساب، وحساب موقع على صفّ فارغ. */
  const baseRoutes = (over = {}) => [
    { match: /SELECT id, salla_merchant_id FROM merchants WHERE id/, first: over.store ?? { id: "m_store", salla_merchant_id: "999" } },
    { match: /SELECT 1 AS x FROM accounts WHERE merchant_id/, first: over.storeHasAccount ?? null },
    { match: /SELECT locked_until FROM login_attempts/, first: over.locked ? { locked_until: "2999-01-01 00:00:00" } : null },
    { match: /SELECT \* FROM accounts WHERE email/, first: over.account === undefined
        ? { merchant_id: "m_site", email: "review@aura.sa", password_hash: hash, password_salt: salt }
        : over.account },
    { match: /SELECT failed_count FROM login_attempts/, first: { failed_count: 1 } },
    { match: /SELECT disabled FROM accounts/, first: { disabled: over.disabled ? 1 : 0 } },
    { match: /SELECT m\.salla_merchant_id AS s/, first: over.own ?? { s: null, t: 0, p: 0 } },
    { match: /UPDATE accounts SET session_version/, first: () => ({ session_version: 3 }) }
  ];
  const envWith = (db) => ({ DB: db, HALA_CACHE: null });
  const run = async (over, password = "correct-horse-9") => {
    const db = fakeDb(baseRoutes(over));
    let err = null, res = null;
    try {
      res = await claimStoreWithAccount(envWith(db), { storeMerchantId: "m_store", email: "review@aura.sa", password });
    } catch (e) { err = e; }
    return { db, err, res, sqls: db.log.map((l) => l.sql) };
  };
  const moved = (sqls) => sqls.some((s) => /UPDATE accounts SET merchant_id = \? WHERE merchant_id = \?/.test(s));

  // ── النجاح: الحساب ينتقل لصفّ المتجر ──────────────────────────────────
  {
    const { err, res, db, sqls } = await run({});
    assert(!err && res?.merchantId === "m_store", "CLAIM-1: الربط ينجح ويرجّع صفّ المتجر هويةً للجلسة");
    const upd = db.log.find((l) => /UPDATE accounts SET merchant_id = \?/.test(l.sql));
    assert(
      upd && upd.args[0] === "m_store" && upd.args[1] === "m_site",
      "CLAIM-2: الاتجاه صحيح — الحساب ينتقل إلى صفّ المتجر، لا البيانات إلى صفّ الحساب"
    );
    assert(
      db.log.some((l) => /DELETE FROM merchants WHERE id/.test(l.sql) && l.args[0] === "m_site"),
      "CLAIM-3: صفّ الحساب القديم يُحذف — لا صفّ يتيم بلا متجر ولا حساب"
    );

    // الترتيب هو الصحة هنا.
    const iBumpOld = db.log.findIndex((l) => /session_version/.test(l.sql) && l.args[0] === "m_site");
    const iMove = db.log.findIndex((l) => /UPDATE accounts SET merchant_id = \?/.test(l.sql));
    const iBumpStore = db.log.findIndex((l) => /session_version/.test(l.sql) && l.args[0] === "m_store");
    assert(
      iBumpOld >= 0 && iBumpOld < iMove,
      "CLAIM-4: جلسات الحساب القديمة تُسقط قبل النقل — بعده لا صفّ يحمل رقمها"
    );
    assert(
      iBumpStore > iMove,
      "CLAIM-5: نسخة جلسة صفّ المتجر تُرفع بعد النقل — وإلا طُرد التاجر بصمت حين تنتهي مرآة KV"
    );
  }

  // ── إثبات الملكية ────────────────────────────────────────────────────────
  {
    const { err, sqls } = await run({}, "wrong-password");
    assert(err instanceof ClaimError && err.status === 401 && err.code === "BAD_CREDENTIALS", "CLAIM-6: كلمة مرور خاطئة ⇒ ٤٠١");
    assert(!moved(sqls), "CLAIM-7: كلمة مرور خاطئة لا تنقل شيئاً");
    assert(
      sqls.some((s) => /INSERT INTO login_attempts/.test(s)),
      "CLAIM-8: الفشل يُسجَّل بقفل تسجيل الدخول نفسه — لا باب جانبي للتخمين"
    );
  }
  {
    const { err, sqls } = await run({ account: null });
    assert(
      err?.status === 401 && err.message === "البريد أو كلمة المرور غير صحيحة.",
      "CLAIM-9: بريد غير موجود ⇒ نفس رسالة كلمة المرور الخاطئة (لا تعداد للحسابات)"
    );
    assert(!moved(sqls), "CLAIM-10: بريد غير موجود لا ينقل شيئاً");
  }
  {
    const { err, sqls } = await run({ locked: true });
    assert(err?.status === 429 && err.code === "LOCKED", "CLAIM-11: البريد المقفول ⇒ ٤٢٩ قبل فحص كلمة المرور");
    assert(!sqls.some((s) => /SELECT \* FROM accounts WHERE email/.test(s)), "CLAIM-12: القفل يسبق قراءة الحساب");
  }
  {
    const { err, sqls } = await run({ disabled: true });
    assert(err?.status === 403 && err.code === "ACCOUNT_DISABLED", "CLAIM-13: حساب معطّل ⇒ ٤٠٣");
    assert(!moved(sqls), "CLAIM-14: الحساب المعطّل لا يُنقل");
  }

  // ── متى يُرفض الربط ──────────────────────────────────────────────────────
  for (const [label, own] of [
    ["معرّف سلة", { s: "123", t: 0, p: 0 }],
    ["توكن", { s: null, t: 1, p: 0 }],
    ["منتجات", { s: null, t: 0, p: 5 }]
  ]) {
    const { err, sqls } = await run({ own });
    assert(
      err?.status === 409 && err.code === "ACCOUNT_HAS_STORE" && !moved(sqls),
      `CLAIM-15/${label}: حساب يملك متجراً (${label}) ⇒ رفض بلا دمج صامت`
    );
  }
  {
    const { err, sqls } = await run({ storeHasAccount: { x: 1 } });
    assert(err?.code === "ACCOUNT_EXISTS" && !moved(sqls), "CLAIM-16: صفّ متجر له حساب ⇒ لا يُستبدل صاحبه");
  }
  {
    const { err } = await run({ store: { id: "m_store", salla_merchant_id: null } });
    assert(err?.code === "NO_STORE", "CLAIM-17: جلسة بلا متجر سلة ⇒ لا شيء يُربط");
  }
  {
    const db = fakeDb([{ match: /SELECT id, salla_merchant_id FROM merchants/, first: null }]);
    let err = null;
    try { await claimStoreWithAccount(envWith(db), { storeMerchantId: "m_ghost", email: "a@b.co", password: "x" }); }
    catch (e) { err = e; }
    assert(err?.status === 404 && err.code === "MERCHANT_NOT_FOUND", "CLAIM-18: صفّ متجر غير موجود ⇒ ٤٠٤");
  }
  {
    const { err } = await run({ own: { s: "123", t: 0, p: 0 } });
    assert(!/123|m_site|m_store/.test(err?.message || ""), "CLAIM-19: رسائل الرفض لا تكشف معرّفات أي صفّ");
  }

  // ── بوابات نقطة الدخول ──────────────────────────────────────────────────
  {
    const api = read("../../functions/api/auth/claim_store.js");
    assert(
      /getSessionMerchantId\(request, env\)/.test(api) && !/body\.(merchantId|storeId)/.test(api),
      "CLAIM-20: صفّ المتجر من الجلسة فقط — لا معرّف من الجسم (منع الاستيلاء)"
    );
    assert(/"claim_store"[^)]*failClosed: true/.test(api), "CLAIM-21: حدّ معدل fail-closed");
    assert(
      /createSessionToken\(env, merchantId\)/.test(api) && /Set-Cookie/.test(api),
      "CLAIM-22: كوكي جديد بعد النقل — نسخة الجلسة تغيّرت فالقديم لا يتحقق"
    );
    assert(/export const onRequestPost = withApi\(/.test(api), "CLAIM-23: يمرّ ببوابة CSRF عبر withApi");

    const { onRequestPost } = await import("../../functions/api/auth/claim_store.js");
    const kv = new Map();
    const res = await onRequestPost({
      request: new Request("https://x.test/api/auth/claim_store", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.co", password: "x", storeId: "m_victim", merchantId: "m_victim" })
      }),
      env: { SESSION_SECRET: "s3cr3t", HALA_CACHE: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } } },
      waitUntil() {}
    });
    assert(
      res.status === 401 && (await res.json()).code === "LOGIN_REQUIRED",
      "CLAIM-24: بلا جلسة ⇒ ٤٠١ حتى لو ادّعى الجسم معرّف متجر"
    );
  }

  // ── الواجهة ───────────────────────────────────────────────────────────────
  {
    const js = read("../../public/js/dashboard/account.js");
    const modal = read("../../partials/dashboard-modals.html");
    assert(
      /id="acctModeToggle"/.test(modal) && /onclick="toggleAccountMode\(\)"/.test(modal) && /id="acctTitle"/.test(modal),
      "CLAIM-25: النافذة فيها مبدّل «عندك حساب بموقعنا؟»"
    );
    assert(
      /postClaimStore/.test(js) && /mode === "login" \? await postClaimStore/.test(js),
      "CLAIM-26: وضع الدخول ينادي claim_store لا complete_account"
    );
    assert(
      /res\.status === 409 && \/مسجّل مسبقاً\//.test(js) && /setAccountMode\("login"\)/.test(js),
      "CLAIM-27: بريد مسجّل بوضع الإنشاء ⇒ تنتقل النافذة للدخول بدل رسالة بلا طريق"
    );
    // «أضغط المنتج ما يفتح شي» (رُصد 2026-09-10): جلسة ضاعت داخل إطار سلة ⇒
    // 401 لا 403، فلا نافذة، والخطأ يُكتب تحت الشبكة خارج الشاشة.
    assert(
      /res\.status === 401 && inSallaFrame/.test(js) && /"LOGIN_REQUIRED" && inSallaFrame\) notifyFrameSessionLost\(\)/.test(js),
      "CLAIM-28: جلسة مفقودة داخل إطار سلة تُظهر إشعاراً — لا ضغطة صامتة"
    );
    const studio = read("../../public/js/dashboard/studio.js");
    assert(
      /showMsg\("copyFeedback"[\s\S]{0,400}getElementById\("copyFeedback"\)\?\.scrollIntoView/.test(studio),
      "CLAIM-29: خطأ التوليد يُمرَّر إلى مجال الرؤية — لا رسالة تحت عشرين بطاقة"
    );
  }
}

main().then(done);

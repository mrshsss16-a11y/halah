// حذف ذاتي بطلب التاجر — الوعد الذي يقوله الفيديو وصفحة الأسئلة، منفَّذاً.
//
// ما يُحرس هنا ليس «هل يُحذف» فقط، بل الأمور التي لو انكسرت لصار الوعد كاذباً
// بصمت: ترتيب رفع نسخة الجلسة قبل محو `accounts`، وأن الوضع "salla" لا يمحو
// الحساب، وأن الفشل الجزئي يُقال لا يُبتلع.
import { readFileSync } from "node:fs";
import { createRunner } from "../_helpers.mjs";

const { assert, done } = createRunner("account-deletion");
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

/** D1 وهمي يسجّل كل SQL بالترتيب — الترتيب نفسه جزء من الصحة هنا. */
function fakeDb({ failOn = null } = {}) {
  const sqls = [];
  return {
    sqls,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            run: async () => {
              if (failOn && sql.includes(failOn)) throw new Error("D1 down");
              sqls.push({ sql, args });
              return { meta: { changes: 1 } };
            },
            // bumpSessionVersion يستخدم `.first()` مع RETURNING — تسجيله هنا
            // ضروري وإلا غاب من ترتيب الاستعلامات الذي يفحصه DEL-8.
            first: async () => {
              if (failOn && sql.includes(failOn)) throw new Error("D1 down");
              sqls.push({ sql, args });
              return /session_version/.test(sql) ? { session_version: 2 } : null;
            },
            all: async () => ({ results: [] })
          };
        },
        run: async () => { sqls.push({ sql, args: [] }); return { meta: { changes: 1 } }; },
        first: async () => null
      };
    },
    batch: async (stmts) => { sqls.push({ sql: "BATCH", args: [stmts.length] }); return []; }
  };
}

const envWith = (db) => ({ DB: db, HALA_CACHE: null });

async function main() {
  const { deleteMerchantAccount, DELETE_CONFIRM_PHRASE, DELETE_MODES } =
    await import("../../functions/_lib/domain/accountDeletion.js");

  assert(DELETE_CONFIRM_PHRASE === "احذف بياناتي", "DEL-1: عبارة التأكيد عربية ومحدَّدة بمصدر واحد");
  assert(
    DELETE_MODES.length === 2 && DELETE_MODES.includes("salla") && DELETE_MODES.includes("account"),
    "DEL-2: وضعان فقط — فكّ ربط، أو حذف كامل"
  );

  // ── الوضع "salla": بيانات المتجر تُمحى والحساب يبقى ──────────────────
  {
    const db = fakeDb();
    const res = await deleteMerchantAccount(envWith(db), "m_1", "salla");
    const joined = db.sqls.map((s) => s.sql).join("\n");
    assert(res.accountDeleted === false, "DEL-3: الوضع salla لا يدّعي حذف الحساب");
    assert(
      !/DELETE FROM accounts WHERE merchant_id/.test(joined) && !/DELETE FROM merchants WHERE id/.test(joined),
      "DEL-4: الوضع salla لا يلمس accounts ولا صفّ merchants — الربط يعود بضغطة"
    );
    assert(
      /DELETE FROM store_products WHERE merchant_id/.test(joined),
      "DEL-5: بيانات المتجر تُمحى فعلاً بالوضع salla (لا فكّ ربط شكلي)"
    );
  }

  // ── الوضع "account": كل ما سبق + الحساب والصفّ ───────────────────────
  {
    const db = fakeDb();
    const res = await deleteMerchantAccount(envWith(db), "m_2", "account");
    const order = db.sqls.map((s) => s.sql);
    const joined = order.join("\n");
    assert(res.accountDeleted === true, "DEL-6: الوضع account يحذف الحساب");
    assert(
      /DELETE FROM accounts WHERE merchant_id/.test(joined) && /DELETE FROM merchants WHERE id/.test(joined),
      "DEL-7: الحساب وصفّ merchants كلاهما يُمحى — لا بريد محجوز بلا بيانات خلفه"
    );

    // الترتيب: رفع نسخة الجلسة يكتب على `accounts`؛ لو جاء بعد حذفه فلا صفّ
    // يحمل الرقم، وكل جلسة حيّة (ونسخة مسروقة) تبقى صالحة بعد «الحذف».
    const iBump = order.findIndex((s) => /session_version/.test(s));
    const iDel = order.findIndex((s) => /DELETE FROM accounts WHERE merchant_id/.test(s));
    assert(
      iBump >= 0 && iDel >= 0 && iBump < iDel,
      "DEL-8: نسخة الجلسة تُرفع قبل حذف accounts — وإلا بقيت الجلسات صالحة بعد الحذف"
    );
  }

  // ── الصدق عند الفشل الجزئي ───────────────────────────────────────────
  {
    const db = fakeDb({ failOn: "DELETE FROM accounts WHERE merchant_id" });
    const res = await deleteMerchantAccount(envWith(db), "m_3", "account");
    assert(
      res.ok === false && res.failed.some((f) => f.startsWith("accounts:")),
      "DEL-9: فشل جدول واحد يُرجَّع مسمّى — لا «تم الحذف ✅» فوق محو ناقص"
    );
    assert(
      res.accountDeleted === true && db.sqls.some((s) => /DELETE FROM merchants WHERE id/.test(s.sql)),
      "DEL-10: فشل جزئي لا يوقف بقية المحو — الأفضل ناقص لا لا شيء"
    );
  }

  // ── تحرير معرّف متجر سلة ─────────────────────────────────────────────
  //
  // العمود UNIQUE: إبقاؤه بعد محوٍ كامل يحتجز المتجر عند صفّ فارغ فلا يُربط
  // بأي حساب آخر أبداً. رُصد عملياً حين تعذّر ربط المتجر بحساب المراجعة.
  {
    const db = fakeDb();
    await deleteMerchantAccount(envWith(db), "m_5", "salla");
    const upd = db.sqls.find((s) => /UPDATE merchants/.test(s.sql) && /store_name = NULL/.test(s.sql));
    assert(
      upd && /salla_merchant_id = NULL/.test(upd.sql),
      "DEL-23: المحو يحرّر معرّف متجر سلة — وإلا بقي المتجر محتجزاً بصفّ فارغ"
    );
  }

  // ── مدخلات غير صالحة ─────────────────────────────────────────────────
  {
    const bad = await deleteMerchantAccount(envWith(fakeDb()), "m_4", "everything");
    assert(bad.ok === false && bad.failed.includes("bad-mode"), "DEL-11: وضع غير معروف يُرفض ولا يُعامل كـaccount");
    const noId = await deleteMerchantAccount(envWith(fakeDb()), "", "account");
    assert(noId.ok === false, "DEL-12: بلا معرّف تاجر لا حذف — لا استعلام بلا قيد");
  }

  // ── بوابات نقطة الدخول ───────────────────────────────────────────────
  {
    const api = read("../../functions/api/store/delete.js");
    assert(
      /requireCompletedAccount\(request, env\)/.test(api),
      "DEL-13: الحذف خلف جلسة حساب مكتمل — لا معرّف متجر يُرسله العميل"
    );
    assert(
      /checkRateLimit\(env, clientIp\(request\), "store_delete"/.test(api),
      "DEL-14: حدّ معدل على فعل لا رجعة فيه"
    );
    assert(
      /!== DELETE_CONFIRM_PHRASE/.test(api) && /CONFIRM_REQUIRED/.test(api),
      "DEL-15: عبارة تأكيد مكتوبة يدوياً إلزامية بالخادم لا بالواجهة وحدها"
    );
    assert(
      /sessionCookieHeader\("", \{ clear: true \}\)/.test(api),
      "DEL-16: الكوكي يُمسح بعد الحذف — لا شاشة خطأ بعد نجاح"
    );
    assert(
      /SELF_DELETE_PARTIAL/.test(api),
      "DEL-17: الفشل الجزئي يُسجَّل بكود مميّز — أثر نلاحقه لا صمت"
    );
  }

  // ── الواجهة تقول ما يحدث فعلاً ───────────────────────────────────────
  {
    const store = read("../../public/js/dashboard/store.js");
    const partial = read("../../partials/dashboard-store.html");
    assert(
      /id="deleteConfirmInput"/.test(partial) && /id="deleteSallaBtn"/.test(partial) && /id="deleteAccountBtn"/.test(partial),
      "DEL-18: زرّان منفصلان بالواجهة — فكّ الربط ليس حذف الحساب"
    );
    assert(
      /disabled/.test(partial) && /onDeleteConfirmInput\(\)/.test(partial),
      "DEL-19: الزرّان معطّلان حتى تُكتب العبارة — لا ضغطة عابرة"
    );
    assert(
      /if \(!res\.ok \|\| data\?\.error\)/.test(store),
      "DEL-20: خطأ خادم بلا حقل error لا يُعرض كنجاح"
    );
    assert(
      /data\.partial/.test(store) && /بقيت أجزاء تعذّر محوها/.test(store),
      "DEL-21: الحذف الجزئي يُقال للتاجر كما هو"
    );
    // DEL-22 عُدّل 2026-09-10: window.confirm قد يُحجب داخل إطار سلة المعزول
    // فيرجع false فوراً ويتعطّل الحذف بصمت. التأكيد الآن عبر confirmAction
    // (نافذة سلة داخل الإطار، ونافذة المتصفح خارجه) بمتغيّر danger.
    assert(
      /await confirmAction\(\{[\s\S]{0,300}message: warn[\s\S]{0,200}variant: "danger"/.test(store) && !/window\.confirm\(/.test(store),
      "DEL-22: تأكيد ثانٍ قبل النداء بنافذة تعمل داخل سلة — العبارة وحدها لا تكفي لفعل نهائي"
    );
  }
}

main().then(done);

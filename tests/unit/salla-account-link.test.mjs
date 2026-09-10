// ربط متجر سلة بحساب التاجر المسجَّل دخوله — لا بصفّ يُشتقّ من معرّف سلة.
//
// الخلل الذي تحرسه هذي الاختبارات رُصد حياً 2026-09-10: تاجر سجّل بالموقع ثم
// ضغط «اربط متجر سلة» فخرج بحسابين — حسابه ببريده فاضياً، ومتجره وعشرون
// منتجاً تحت صفّ ثانٍ. سجّل دخوله فرأى صفر منتجات وظنّ السحب معطّلاً.
import { readFileSync } from "node:fs";
import { createRunner } from "../_helpers.mjs";

const { assert, done } = createRunner("salla-account-link");
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

/**
 * D1 وهمي فوق جدولين. `rows.merchants` مصفوفة كائنات، و`rows.accounts` مجموعة
 * معرّفات — بقدر ما يحتاجه المنطق، لا محاكاة SQLite كاملة.
 */
function fakeDb({ merchants = [], accounts = [] } = {}) {
  const state = { merchants: merchants.map((m) => ({ ...m })), accounts: new Set(accounts), writes: [] };
  return {
    state,
    prepare(sql) {
      return {
        bind(...a) {
          return {
            first: async () => {
              if (/FROM merchants WHERE salla_merchant_id/.test(sql)) {
                return state.merchants.find((m) => m.salla_merchant_id === a[0]) || null;
              }
              if (/FROM accounts WHERE merchant_id/.test(sql)) {
                return state.accounts.has(a[0]) ? { x: 1 } : null;
              }
              return null;
            },
            run: async () => {
              state.writes.push({ sql, args: a });
              if (/^INSERT INTO merchants/.test(sql.trim())) {
                state.merchants.push({ id: a[0], salla_merchant_id: a[1], store_name: a[2] });
              }
              if (/UPDATE merchants SET store_name = \? WHERE id = \?/.test(sql)) {
                const m = state.merchants.find((x) => x.id === a[1]);
                if (m) m.store_name = a[0];
              }
              if (/UPDATE merchants[\s\S]*SET salla_merchant_id/.test(sql)) {
                const m = state.merchants.find((x) => x.id === a[2]);
                if (m) { m.salla_merchant_id = a[0]; m.store_name = a[1] ?? m.store_name; }
              }
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };
}

async function main() {
  const { linkSallaToAccount, SallaLinkConflictError, linkConflictMessage } =
    await import("../../functions/_lib/domain/sallaAccountLink.js");

  // ── الحالة التي كسرت: حساب مسجَّل + متجر جديد ────────────────────────
  {
    const db = fakeDb({ merchants: [{ id: "m_acct", salla_merchant_id: null, store_name: "فريق سلة" }], accounts: ["m_acct"] });
    const id = await linkSallaToAccount({ DB: db }, {
      sallaMerchantId: "1354270932",
      storeName: "متجري",
      sessionMerchantId: "m_acct"
    });
    assert(id === "m_acct", "LINK-1: المتجر يُربط بحساب الجلسة — لا صفّ جديد يُشتقّ من معرّف سلة");
    assert(
      db.state.merchants.find((m) => m.id === "m_acct").salla_merchant_id === "1354270932",
      "LINK-2: معرّف متجر سلة يُكتب على صفّ الحساب نفسه"
    );
    assert(
      db.state.merchants.length === 1,
      "LINK-3: لا صفّ تاجر ثانٍ يُنشَأ — الحسابان المتوازيان هما أصل العطل"
    );
    assert(
      db.state.writes.some((w) => /salla_disconnected_at = NULL/.test(w.sql)),
      "LINK-4: الربط يمسح ختم فكّ الربط — وإلا ظهر «غير مرتبط» بعد ربط ناجح"
    );
  }

  // ── إعادة ربط نفس المتجر بنفس الحساب ────────────────────────────────
  {
    const db = fakeDb({ merchants: [{ id: "m_a", salla_merchant_id: "999", store_name: "س" }], accounts: ["m_a"] });
    const id = await linkSallaToAccount({ DB: db }, { sallaMerchantId: "999", storeName: "س٢", sessionMerchantId: "m_a" });
    assert(id === "m_a", "LINK-5: إعادة ربط نفس المتجر بنفس الحساب تمرّ — الحالة الطبيعية بعد فكّ ربط");
    assert(
      db.state.merchants.find((m) => m.id === "m_a").store_name === "س٢",
      "LINK-6: اسم المتجر يُحدَّث عند تغيّره بسلة"
    );
  }

  // ── التعارض: المتجر مرتبط بحساب آخر ─────────────────────────────────
  {
    const db = fakeDb({
      merchants: [
        { id: "m_mine", salla_merchant_id: null, store_name: null },
        { id: "m_other", salla_merchant_id: "777", store_name: "متجر غيري" }
      ],
      accounts: ["m_mine", "m_other"]
    });
    let err = null;
    try {
      await linkSallaToAccount({ DB: db }, { sallaMerchantId: "777", sessionMerchantId: "m_mine" });
    } catch (e) { err = e; }
    assert(err instanceof SallaLinkConflictError && err.reason === "claimed", "LINK-7: متجر مرتبط بحساب له بريد ⇒ رفض مصنَّف claimed");
    assert(
      db.state.merchants.find((m) => m.id === "m_other").salla_merchant_id === "777",
      "LINK-8: الرفض لا ينقل الملكية — بيانات الحساب الآخر لم تُمسّ"
    );
    assert(
      !/m_other|777/.test(linkConflictMessage("claimed")),
      "LINK-9: رسالة التعارض لا تكشف شيئاً عن الصفّ الآخر (معرّفه أو متجره)"
    );
  }

  // ── التعارض: صفّ ويبهوك بلا حساب — إرشاد مختلف ──────────────────────
  {
    const db = fakeDb({
      merchants: [
        { id: "m_mine", salla_merchant_id: null, store_name: null },
        { id: "m_hook", salla_merchant_id: "555", store_name: "مثبَّت من سلة" }
      ],
      accounts: ["m_mine"]
    });
    let err = null;
    try {
      await linkSallaToAccount({ DB: db }, { sallaMerchantId: "555", sessionMerchantId: "m_mine" });
    } catch (e) { err = e; }
    assert(err?.reason === "orphan", "LINK-10: صفّ بلا حساب يُصنَّف orphan لا claimed");
    assert(
      /تطبيقاتي/.test(linkConflictMessage("orphan")) && !/سجّل دخولك بذاك الحساب/.test(linkConflictMessage("orphan")),
      "LINK-11: إرشاد orphan يوجّه لفتح هالة من لوحة سلة، لا لحساب لا وجود له"
    );
  }

  // ── مسار الويبهوك: بلا جلسة، السلوك القديم كما هو ───────────────────
  {
    const db = fakeDb();
    const id = await linkSallaToAccount({ DB: db }, { sallaMerchantId: "111", storeName: "جديد", sessionMerchantId: null });
    assert(/^m_/.test(id) && db.state.merchants.length === 1, "LINK-12: بلا جلسة يُنشأ صفّ من معرّف سلة — Easy Mode لم يتغيّر");
    const again = await linkSallaToAccount({ DB: db }, { sallaMerchantId: "111", storeName: "جديد", sessionMerchantId: null });
    assert(again === id, "LINK-13: إعادة التثبيت ترجع لنفس الصفّ — لا تكرار");
  }

  // ── التنظيف عند المصدر ───────────────────────────────────────────────
  {
    const db = fakeDb();
    await linkSallaToAccount({ DB: db }, { sallaMerchantId: "222", storeName: "<script>x</script>متجر", sessionMerchantId: null });
    assert(
      !/<script>/.test(db.state.merchants[0].store_name),
      "LINK-14: اسم المتجر يُنظَّف بالمصدر — يُعرض بجدول الأدمن (C3)"
    );
  }

  // ── التوصيل بنقطة النهاية ────────────────────────────────────────────
  {
    const cb = read("../../functions/api/auth/salla/callback.js");
    assert(
      /getSessionMerchantId\(request, env\)/.test(cb) && /sessionMerchantId\s*$/m.test(cb),
      "LINK-15: callback يمرّر جلسة التاجر للمبادلة — بدونها يعود العطل كما كان"
    );
    assert(
      /SallaLinkConflictError/.test(cb) && /409/.test(cb) && /SALLA_ALREADY_LINKED/.test(cb),
      "LINK-16: التعارض يرجّع 409 برسالة تشرح المخرج، لا 502 «تعذّر الربط»"
    );
    const salla = read("../../functions/_lib/domain/salla.js");
    assert(
      /sessionMerchantId = null/.test(salla) && /linkSallaToAccount/.test(salla),
      "LINK-17: exchangeSallaCode يقبل الجلسة ويفوّض القرار لوحدة الربط"
    );
    assert(
      !/const existing = await getMerchantBySalla/.test(salla),
      "LINK-18: لا نسخة ثانية من منطق الإدراج بـsalla.js — مصدر واحد يتباعد عنه شيء"
    );
  }
}

main().then(done);

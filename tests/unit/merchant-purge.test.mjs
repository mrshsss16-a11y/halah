// SEC-5 + SEC-9 (2026-09-17) — ما يبقى بعد «الحذف النهائي»، ومن يحرس الأفعال
// التي لا رجعة فيها حين يسقط KV.
//
// SEC-5: ثلاثة جداول مصادقة مفتاحها البريد لا `merchant_id`، فحارس PURGE-1 لا
// يراها أصلاً: `login_attempts` و`password_resets` و`email_verifications`.
// بقاؤها بعد حذف الحساب يكذّب الوعد، ويترك رمز إعادة تعيين صالحاً لبريدٍ
// «محذوف» لو سُجّل من جديد.
//
// SEC-9: `checkRateLimit` افتراضه fail-open. على نقطة عامة تكتب بالقاعدة، وعلى
// فعل محوٍ لا رجعة فيه، fail-open يعني أن عطل KV يفتح الباب بلا سقف.
import { createRunner } from "../_helpers.mjs";

const { assert, done } = createRunner("merchant-purge");

/** D1 وهمي يسجّل كل استعلام؛ `accounts.email` يُجاب من `first()`. */
function fakeDb({ email = "merchant@example.test" } = {}) {
  const calls = [];
  return {
    calls,
    deletes: () => calls.filter((c) => /^DELETE FROM/.test(c.sql)),
    prepare(sql) {
      const q = sql.replace(/\s+/g, " ").trim();
      return {
        bind: (...args) => ({
          run: async () => { calls.push({ sql: q, args }); return {}; },
          first: async () => {
            calls.push({ sql: q, args });
            return /^SELECT email FROM accounts/.test(q) ? (email ? { email } : null) : null;
          },
          all: async () => ({ results: [] })
        }),
        run: async () => { calls.push({ sql: q, args: [] }); return {}; },
        first: async () => null
      };
    }
  };
}

const EMAIL_TABLES = ["login_attempts", "password_resets", "email_verifications"];

async function main() {
  const { purgeMerchantData } = await import("../../functions/_lib/domain/merchantPurge.js");

  // ── حذف الحساب: بقايا المصادقة المفتاحة بالبريد تُمحى ────────────────
  {
    const db = fakeDb();
    const out = await purgeMerchantData({ DB: db }, "m_1", { keepAccount: false });
    assert(out.purged === true && out.failed.length === 0, "PURGE-10: المحو الكامل ينجح بلا فشل مُبلَّغ");

    for (const t of EMAIL_TABLES) {
      assert(
        db.deletes().some((c) => c.sql === `DELETE FROM ${t} WHERE email = ?` && c.args[0] === "merchant@example.test"),
        `PURGE-11: ${t} يُمحى ببريد الحساب — لا يراه حارس merchant_id`
      );
    }

    // الترتيب: البريد يُقرأ قبل محو `accounts`، وإلا ضاع المفتاح إلى الأبد.
    const iRead = db.calls.findIndex((c) => /^SELECT email FROM accounts/.test(c.sql));
    const iDel = db.calls.findIndex((c) => c.sql === "DELETE FROM accounts WHERE merchant_id = ?");
    assert(iRead >= 0 && iDel >= 0 && iRead < iDel, "PURGE-12: البريد يُقرأ قبل حذف accounts — بعده لا مفتاح");

    // الحجوزات العامة ليست بيانات تاجر (بلا عمود merchant_id) — إعفاء موثّق.
    assert(
      !db.calls.some((c) => /consultation_bookings/.test(c.sql)),
      "PURGE-13: consultation_bookings لا يُمَس — حجوزات موقع عام لا بيانات تاجر"
    );
  }

  // ── وضع "salla": الحساب باقٍ، فقفله ورموزه ليست من طلب التاجر ────────
  {
    const db = fakeDb();
    await purgeMerchantData({ DB: db }, "m_2", { keepAccount: true });
    assert(
      !db.calls.some((c) => /WHERE email = \?/.test(c.sql)) &&
        !db.calls.some((c) => /^SELECT email FROM accounts/.test(c.sql)),
      "PURGE-14: keepAccount ⇒ لا محو بالبريد ولا قراءة له — الحساب لم يُحذف أصلاً"
    );
  }

  // ── بلا بريد (صفّ حساب غير موجود) لا محو بمفتاح فارغ ─────────────────
  {
    const db = fakeDb({ email: null });
    const out = await purgeMerchantData({ DB: db }, "m_3", { keepAccount: false });
    assert(
      out.purged === true && !db.calls.some((c) => /WHERE email = \?/.test(c.sql)),
      "PURGE-15: بلا بريد لا حذف بمفتاح فارغ — لا مسح عابر للحسابات"
    );
  }

  // ── SEC-9: حدّ المعدل fail-closed على نقطة الحجز العامة ──────────────
  {
    const { onRequestPost } = await import("../../functions/api/consultation/book.js");
    const post = (env) =>
      onRequestPost({
        request: new Request("https://x.test/api/consultation/book", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "ت", phone: "+966500000000", slotLabel: "الأحد ٤م" })
        }),
        env,
        waitUntil() {}
      });

    const res = await post({ HALA_CACHE: null, DB: null });
    assert(res.status === 429, "BOOK-1: بلا ربط KV ⇒ ٤٢٩ لا ٢٠٠ — لا حجز بلا سقف حين يسقط العدّاد");

    // ضبط: مع KV سليم العدّاد ليس هو المانع (الرفض هنا من غياب القاعدة).
    const kv = new Map();
    const ok = await post({
      HALA_CACHE: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } },
      DB: null
    });
    assert(ok.status === 503, "BOOK-2: مع KV سليم لا يُرفض بحدّ معدل — الرفض من غياب القاعدة وحده");
  }
}

main().then(done);

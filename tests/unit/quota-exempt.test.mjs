// الإعفاء من الحصة الشهرية بمتغيّر البيئة `UNMETERED_MERCHANT_IDS`.
//
// أُضيف 2026-09-10 لمتجر مراجعة سلة. يُحرس هنا ما لو انكسر صار الإعفاء خطراً
// أو بلا أثر: المُدرج لا يلمس D1 إطلاقاً، غير المُدرج يُعدّ كالعادة، المطابقة
// تامة (لا يُعفى معرّف لأنه جزء من معرّف آخر)، وغياب المتغيّر لا يُعفي أحداً.
import { createRunner } from "../_helpers.mjs";

const { assert, done } = createRunner("quota-exempt");

/** D1 وهمي يعدّ كل استعلام — لمعرفة هل مرّ الطلب بالعدّاد فعلاً أم لا. */
function countingDb() {
  const db = {
    calls: 0,
    prepare() {
      db.calls += 1;
      const stmt = {
        bind() { return stmt; },
        async run() { return { meta: { changes: 1 } }; },
        async first() { return { used: 1 }; }
      };
      return stmt;
    }
  };
  return db;
}

async function main() {
  const { checkAndConsumeMonthly, getMonthlyUsage, DAILY_BUCKET_LIMITS } = await import("../../functions/_lib/core/meter.js");

  {
    const DB = countingDb();
    const env = { DB, UNMETERED_MERCHANT_IDS: "m_other, m_review " };
    const r = await checkAndConsumeMonthly(env, "m_review", "description");
    assert(r.ok && r.used === 0 && r.remaining === DAILY_BUCKET_LIMITS.description, "EXEMPT-1: المُدرج يُسمح له بلا استهلاك");
    assert(DB.calls === 0, "EXEMPT-2: المُدرج لا يلمس D1 إطلاقاً — لا يُحتسب بأرقام الإنتاج");
    const u = await getMonthlyUsage(env, "m_review");
    assert(u.description.remaining === u.description.limit && DB.calls === 0, "EXEMPT-3: عرض الحصة للمُدرج كامل ولا يقرأ D1");
  }

  {
    const DB = countingDb();
    const r = await checkAndConsumeMonthly({ DB, UNMETERED_MERCHANT_IDS: "m_review" }, "m_normal", "description");
    assert(r.ok && DB.calls > 0, "EXEMPT-4: غير المُدرج يمرّ بالعدّاد كالعادة");
  }

  {
    const DB = countingDb();
    await checkAndConsumeMonthly({ DB, UNMETERED_MERCHANT_IDS: "m_abc" }, "m_ab", "description");
    assert(DB.calls > 0, "EXEMPT-5: مطابقة تامة — m_ab لا يُعفى لأن m_abc مُدرج");
  }

  {
    const DB = countingDb();
    await checkAndConsumeMonthly({ DB }, "m_review", "description");
    assert(DB.calls > 0, "EXEMPT-6: بلا المتغيّر لا إعفاء لأحد عدا hala الثابت");
    const DB2 = countingDb();
    await checkAndConsumeMonthly({ DB: DB2, UNMETERED_MERCHANT_IDS: " , ," }, "m_review", "description");
    assert(DB2.calls > 0, "EXEMPT-7: متغيّر فارغ أو فواصل فقط لا يُعفي أحداً");
  }

  {
    const DB = countingDb();
    await checkAndConsumeMonthly({ DB, UNMETERED_MERCHANT_IDS: "m_review" }, "hala", "description");
    assert(DB.calls === 0, "EXEMPT-8: hala الثابت يبقى معفى مع وجود القائمة");
  }
}

main().then(done);

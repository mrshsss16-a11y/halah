// حد الأوصاف اليومي (قرار المالك 2026-09-12): ٥ لكل متجر و٢٥ للمشروع كله، والمحاولة الفاشلة تُرجَع.
import { readFileSync } from "node:fs";
import { createRunner, fakeKv } from "../_helpers.mjs";
import { checkAndConsumeMonthly, getMonthlyUsage, refundQuota, DAILY_BUCKET_LIMITS } from "../../functions/_lib/core/meter.js";

const { assert, done } = createRunner("quota-daily");

// D1 وهمي يطبّق شرط WHERE used + ? <= ? بالتحديث، والإرجاع، والقراءة — محاسبة حقيقية لا «نعم» دائمة.
function fakeQuotaDb() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      return {
        bind(...a) {
          return {
            run: async () => {
              if (/INSERT INTO usage_quota/.test(sql)) {
                const [m, p, b, cost, , , lim] = a;
                const k = `${m}|${p}|${b}`;
                const used = rows.get(k) || 0;
                if (rows.has(k) && /WHERE used \+ \? <= \?/.test(sql) && used + cost > lim) return { meta: { changes: 0 } };
                rows.set(k, used + cost);
                return { meta: { changes: 1 } };
              }
              if (/UPDATE usage_quota/.test(sql)) {
                const [cost, m, p, b] = a;
                const k = `${m}|${p}|${b}`;
                rows.set(k, Math.max(0, (rows.get(k) || 0) - cost));
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
            first: async () => {
              if (!/merchant_id = \?/.test(sql)) throw new Error("quota query is not merchant-scoped");
              const k = a.join("|");
              return rows.has(k) ? { used: rows.get(k) } : null;
            }
          };
        }
      };
    }
  };
}

const LIMIT = DAILY_BUCKET_LIMITS.description;

async function drain(env, id, n) {
  let last = null;
  for (let i = 0; i < n; i++) last = await checkAndConsumeMonthly(env, id, "description");
  return last;
}

async function main() {
  for (const [label, makeEnv] of [["D1", () => ({ DB: fakeQuotaDb() })], ["KV", () => ({ DB: fakeQuotaDb(), HALA_CACHE: fakeKv() })]]) {
    {
      const env = makeEnv();
      const fifth = await drain(env, "m_a", LIMIT);
      const over = await checkAndConsumeMonthly(env, "m_a", "description");
      const other = await checkAndConsumeMonthly(env, "m_b", "description");
      assert(LIMIT === 5 && fifth.ok && fifth.remaining === 0 && fifth.period === "day", `QD-1/${label}: المتجر يستهلك ٥ أوصاف باليوم`);
      assert(!over.ok && over.scope === "store" && other.ok, `QD-2/${label}: السادس يُرفض بحد المتجر، ومتجر آخر لا يتأثر`);
    }
    {
      const env = makeEnv();
      for (const id of ["s1", "s2", "s3", "s4", "s5"]) await drain(env, id, LIMIT);
      const sixth = await checkAndConsumeMonthly(env, "s6", "description");
      const usage = await getMonthlyUsage(env, "s6");
      assert(!sixth.ok && sixth.scope === "global", `QD-3/${label}: الوصف رقم ٢٦ للمشروع يُرفض بسقف السعة العامة لا بحد المتجر`);
      assert(usage.description.used === 0 && usage.description.remaining === 0, `QD-4/${label}: المتجر المرفوض عاماً لا يُخصم منه، ومتبقيه ٠ لأن سعة اليوم اكتملت (${JSON.stringify(usage.description)})`);
    }
    {
      const env = makeEnv();
      await drain(env, "m_r", 2);
      await refundQuota(env, "m_r", "description");
      const usage = await getMonthlyUsage(env, "m_r");
      assert(usage.description.used === 1 && usage.description.remaining === LIMIT - 1, `QD-5/${label}: المحاولة الفاشلة تُرجَع للمتجر (${JSON.stringify(usage.description)})`);
    }
  }
  {
    // إزالة التطبيق تمحو صفوف D1، وعدّاد KV يبقى ٢٥ ساعة: إعادة التثبيت بنفس اليوم لا تصفّر الحد.
    const env = { DB: fakeQuotaDb(), HALA_CACHE: fakeKv() };
    await drain(env, "m_x", LIMIT);
    env.DB.rows.clear();
    assert(!(await checkAndConsumeMonthly(env, "m_x", "description")).ok, "QD-6: حذف هالة وإعادة تثبيتها بنفس اليوم لا يعطي أوصافاً جديدة");
  }
  {
    const env = { DB: fakeQuotaDb() };
    const msg = await checkAndConsumeMonthly(env, "m_a", "message");
    assert(msg.ok && [...env.DB.rows.keys()].some((k) => /^m_a\|\d{4}-\d{2}\|message$/.test(k)), "QD-7: الرسائل تبقى شهرية (فترة YYYY-MM)");
  }
  {
    const copySrc = readFileSync(new URL("../../functions/api/copy.js", import.meta.url), "utf8");
    const tickSrc = readFileSync(new URL("../../functions/_lib/domain/bulkTick.js", import.meta.url), "utf8");
    const uploadSrc = readFileSync(new URL("../../functions/api/store/bulk/upload.js", import.meta.url), "utf8");
    assert(/catch \(err\) \{\s*\/\/[^\n]*\n\s*await refundQuota\(env, merchantId, "description"\)/.test(copySrc) && /اكتملت سعة هالة لهذا اليوم/.test(copySrc) && /وصلت حد اليوم لمتجرك/.test(copySrc), "QD-8: التوليد المفرد يُرجع المحاولة الفاشلة ويفرّق رسالة حد المتجر عن سعة اليوم");
    assert(/error: DEFERRED_MARKER/.test(tickSrc) && /if \(consumed\) await refundQuota/.test(tickSrc) && !/الحصة الشهرية خلصت/.test(tickSrc), "QD-9: التوليد بالجملة يؤجّل ما فوق الحد لليوم التالي ويُرجع الفاشل");
    assert(/markDeferredItems\(env, \{ jobId, merchantId, fromIndex: nowCount, count: deferred \}\)/.test(uploadSrc) && !/rows\.length = remaining/.test(uploadSrc), "QD-10: رفع ملف بالجملة لا يقصّ الصفوف فوق حد اليوم — يؤجّلها");
  }
}

main().then(done);

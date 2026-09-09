// اختبارات دفعة د (التشغيل والوثائق) — O1..O5، D1. أسلوب tests/api.test.mjs:
// دوال fake بدل موك خارجي، assert بسيط، طباعة PASS/FAIL. لا يلمس api.test.mjs.
import { onRequest as healthHandler } from "../../functions/api/health.js";
import { recordHeartbeat, readHeartbeats } from "../../functions/_lib/core/heartbeat.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

async function runTests() {
  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${message}`);
    }
  }

  console.log("Starting ops-wave tests...\n");

  // ---- O1: health.js يفشل بـ503 عند فحص حرج error/missing، 200 للسليم ----

  function fakeDb({ okSelect1 = true, cronRows = [] } = {}) {
    return {
      prepare(sql) {
        return {
          bind() {
            return this;
          },
          first: async () => {
            if (sql.includes("SELECT 1")) {
              if (!okSelect1) throw new Error("db down");
              return { 1: 1 };
            }
            return null;
          },
          all: async () => {
            if (sql.includes("cron_heartbeat")) return { results: cronRows };
            return { results: [] };
          },
          run: async () => ({ meta: { changes: 1 } })
        };
      }
    };
  }

  function fakeKv() {
    const store = new Map();
    return {
      get: async (k) => (store.has(k) ? store.get(k) : null),
      put: async (k, v) => store.set(k, v),
      delete: async (k) => store.delete(k)
    };
  }

  // كل شيء سليم: 200
  {
    const env = {
      DB: fakeDb({ cronRows: [{ job: "reminders", last_run_at: new Date().toISOString().replace("T", " ").slice(0, 19), last_ok: 1, note: null }] }),
      HALA_CACHE: fakeKv(),
      VECTORIZE_INDEX: {},
      AI: {}
    };
    const res = await healthHandler({ env });
    const body = await res.json();
    assert(res.status === 200, "O1: كل الفحوص الحرجة سليمة ⇒ HTTP 200");
    assert(body.status === "ok", "O1: الجسم status=ok عند السلامة");
  }

  // db مفقود: 503
  {
    const env = { HALA_CACHE: fakeKv(), VECTORIZE_INDEX: {}, AI: {} };
    const res = await healthHandler({ env });
    const body = await res.json();
    assert(res.status === 503, "O1: db مفقود ⇒ HTTP 503");
    assert(body.checks.db === "missing", "O1: checks.db=missing حين لا يوجد binding");
    assert(!("stack" in body) && !JSON.stringify(body).includes("Error:"), "O1: لا تفاصيل داخلية بجسم الاستجابة");
  }

  // db يرمي خطأ فعلياً (error لا missing): 503
  {
    const env = { DB: fakeDb({ okSelect1: false }), HALA_CACHE: fakeKv(), VECTORIZE_INDEX: {}, AI: {} };
    const res = await healthHandler({ env });
    const body = await res.json();
    assert(res.status === 503, "O1: فشل استعلام db (error) ⇒ HTTP 503");
    assert(body.checks.db === "error", "O1: checks.db=error عند رمي الاستعلام خطأ");
  }

  // ai_primary مفقود فقط (db/cache سليمين): يبقى 503 لأنه فحص حرج
  {
    const env = { DB: fakeDb({ cronRows: [] }), HALA_CACHE: fakeKv(), VECTORIZE_INDEX: {} };
    const res = await healthHandler({ env });
    assert(res.status === 503, "O1: ai_primary مفقود وحده كافٍ لإسقاط HTTP إلى 503");
  }

  // فحص غير حرج مفقود (groq/openrouter/vectorize) لا يُسقط الحالة
  {
    const env = { DB: fakeDb({ cronRows: [] }), HALA_CACHE: fakeKv(), AI: {} };
    const res = await healthHandler({ env });
    const body = await res.json();
    assert(res.status === 200, "O1: غياب فحص غير حرج (vectorize/groq/openrouter) لا يُسقط HTTP");
    assert(body.checks.vectorize === "missing", "O1: vectorize يبقى معلوماتياً فقط (missing) بلا التأثير على الحالة");
  }

  // ---- O2: نبض الـcron — الجدول غير موجود = missing، لا يفشل health لأجله ----
  {
    const dbNoTable = {
      prepare(sql) {
        return {
          bind() { return this; },
          first: async () => (sql.includes("SELECT 1") ? { 1: 1 } : null),
          all: async () => { throw new Error("no such table: cron_heartbeat"); }
        };
      }
    };
    const env = { DB: dbNoTable, HALA_CACHE: fakeKv(), VECTORIZE_INDEX: {}, AI: {} };
    const res = await healthHandler({ env });
    const body = await res.json();
    assert(res.status === 200, "O2: جدول cron_heartbeat غير موجود لا يُسقط health (cron ليس فحصاً حرجاً)");
    assert(body.checks.cron === "missing", "O2: checks.cron=missing حين الجدول غير مطبَّق بعد");
  }

  // نبض قديم (>25 دقيقة) ⇒ cron=error
  {
    const staleTs = new Date(Date.now() - 40 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
    const env = {
      DB: fakeDb({ cronRows: [{ job: "healthcheck", last_run_at: staleTs, last_ok: 1, note: null }] }),
      HALA_CACHE: fakeKv(),
      VECTORIZE_INDEX: {},
      AI: {}
    };
    const res = await healthHandler({ env });
    const body = await res.json();
    assert(body.checks.cron === "error", "O2: نبض أقدم من ٢٥ دقيقة ⇒ checks.cron=error");
  }

  // نبض فشل آخر تشغيل (last_ok=0) ⇒ cron=error حتى لو حديث
  {
    const freshTs = new Date().toISOString().replace("T", " ").slice(0, 19);
    const env = {
      DB: fakeDb({ cronRows: [{ job: "bulk_process", last_run_at: freshTs, last_ok: 0, note: "fail" }] }),
      HALA_CACHE: fakeKv(),
      VECTORIZE_INDEX: {},
      AI: {}
    };
    const res = await healthHandler({ env });
    const body = await res.json();
    assert(body.checks.cron === "error", "O2: آخر تشغيل فاشل (last_ok=0) ⇒ checks.cron=error رغم حداثته");
  }

  // recordHeartbeat لا يرمي عند غياب DB (fire-and-forget)
  {
    let threw = false;
    try {
      await recordHeartbeat(null, { job: "x", ok: true });
      await recordHeartbeat({}, { job: "x", ok: true });
    } catch {
      threw = true;
    }
    assert(!threw, "O2: recordHeartbeat لا يرمي عند غياب env/env.DB");
  }

  // recordHeartbeat يكتب فعلياً حين يتوفر DB سليم
  {
    let inserted = null;
    const db = {
      prepare(sql) {
        return {
          bind(...args) {
            inserted = { sql, args };
            return this;
          },
          run: async () => ({ meta: { changes: 1 } })
        };
      }
    };
    await recordHeartbeat({ DB: db }, { job: "reminders", ok: true, note: "sent=3" });
    assert(inserted && inserted.sql.includes("cron_heartbeat"), "O2: recordHeartbeat يكتب على جدول cron_heartbeat");
    assert(inserted && inserted.args[0] === "reminders" && inserted.args[1] === 1, "O2: recordHeartbeat يمرر job وlast_ok=1 بشكل صحيح");
  }

  // readHeartbeats يرجّع null بهدوء (لا رمي) عند خطأ الاستعلام
  {
    const dbErr = { prepare: () => ({ all: async () => { throw new Error("boom"); } }) };
    const res = await readHeartbeats({ DB: dbErr });
    assert(res === null, "O2: readHeartbeats يرجّع null عند فشل الاستعلام بدل الرمي");
    const resNoDb = await readHeartbeats({});
    assert(resNoDb === null, "O2: readHeartbeats يرجّع null بلا env.DB");
  }

  // ---- O3: كود healthcheck.js يحوي فحص توكن واتساب وتوكنات سلة (فحص ثابت) ----
  {
    const src = readFileSync(join(ROOT, "functions/_lib/domain/health.js"), "utf8");
    assert(src.includes("debug_token"), "O3: healthcheck.js يستدعي debug_token للتحقق من توكن واتساب");
    assert(src.includes("checkSallaTokenExpiry"), "O3: healthcheck.js يفحص توكنات سلة القريبة من الانتهاء");
    assert(src.includes("WA_TOKEN_CHECK_THROTTLE_SECONDS"), "O3: فحص توكن واتساب مخنوق بمهلة KV (ساعة)");
    assert(!/(966\d{9}).*(phone|name|email)/i.test(src.replace(/\n/g, " ")), "O3: لا PII واضح مرتبط برقم جوال بالكود");
  }

  // ---- O5: backup-db.mjs يتحقق من محتوى النسخة بعد التصدير ----
  {
    const src = readFileSync(join(ROOT, "scripts/backup-db.mjs"), "utf8");
    assert(src.includes("CREATE TABLE accounts"), "O5: backup-db.mjs يتحقق من وجود CREATE TABLE accounts بالنسخة");
    assert(src.includes("lineCount <= 100") || src.includes("lineCount < 100"), "O5: backup-db.mjs يتحقق من أن عدد الأسطر > ١٠٠");
    assert(src.includes("process.exit(1)"), "O5: backup-db.mjs يخرج بكود فشل (exit 1) عند نسخة غير صالحة");
  }
  {
    const agentMd = readFileSync(join(ROOT, "AGENT.md"), "utf8");
    assert(agentMd.includes("النسخ يدوي") || agentMd.includes("يدوي ومحلي"), "O5: AGENT.md §٦ يوثّق أن النسخ يدوي محلي");
    assert(agentMd.includes("بيد مالك") || agentMd.includes("بيد المالك"), "O5: AGENT.md §٦ يوثّق أن قرار التخزين الخارجي بيد المالك");
  }

  // ---- D1: أرقام موثّقة تطابق الشجرة الفعلية ----
  {
    const { readdirSync } = await import("node:fs");
    const migrationFiles = readdirSync(join(ROOT, "migrations")).filter((f) => /^\d{4}_/.test(f));
    assert(migrationFiles.some((f) => f.startsWith("0027_")), "D1: هجرة 0027 موجودة فعلياً بالمجلد");

    const roadmap = readFileSync(join(ROOT, "docs/ROADMAP.md"), "utf8");
    const completion = readFileSync(join(ROOT, "docs/COMPLETION_PATH.md"), "utf8");
    assert(roadmap.includes("9563b38") || /اختيار متعدد|multi-select|منتجاتي/.test(roadmap), "D1: ROADMAP.md يذكر حالة زر الصور/الاختيار المتعدد المُنجزة");
    assert(completion.includes("9563b38") || /اختيار متعدد|منجز/.test(completion), "D1: COMPLETION_PATH.md يعكس إنجاز الاختيار المتعدد");
  }

  console.log(`\n${passed}/${total} passed.`);
  if (passed !== total) process.exit(1);
}

runTests().catch((err) => {
  console.error("❌ Tests threw an exception:", err);
  process.exit(1);
});

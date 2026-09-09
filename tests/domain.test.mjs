// اختبارات المرحلة ٣ — طبقة `functions/_lib/domain/*` بعد تقطيع `core/db.js`.
//
// المهم هنا **سلوكي لا شكلي**: كل اختبار يشغّل الدالة على D1 وهمي ويتحقق من
// الأثر (SQL المنفَّذ، القيم المربوطة، القيمة المعادة) — لا من نص الملف. هذا
// ما يجعل الاختبار مفيداً بعد نقل الملفات: لو تغيّر السلوك أثناء النقل يسقط.
//
// التغطية: attemptGuard (قفل بعد ٥) · قفل تجديد توكن سلة · نافذة واتساب ٢٤ ساعة
// · إحياء الصفوف المؤجَّلة · ترجمة DomainError بـwithApi لنفس شكل ApiError.
import assertLib from "node:assert";

let passed = 0;
let total = 0;
function assert(cond, name) {
  total += 1;
  if (cond) {
    passed += 1;
    console.log(`✅ PASS: ${name}`);
  } else {
    console.log(`❌ FAIL: ${name}`);
  }
}

/**
 * D1 وهمي بسيط: `handlers` قائمة [مطابق, نتيجة] تُفحص بالترتيب على نص SQL.
 * كل استدعاء يُسجَّل بـ`log` مع قيمه المربوطة، والنتيجة إما قيمة أو دالة(binds).
 */
function fakeDb(handlers = [], log = []) {
  const resolve = (sql, binds, kind) => {
    for (const [match, out] of handlers) {
      if (!match.test(sql)) continue;
      const v = typeof out === "function" ? out(binds, kind) : out;
      if (v !== undefined) return v;
    }
    return undefined;
  };
  return {
    _log: log,
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _binds: [],
        bind(...args) {
          this._binds = args;
          return this;
        },
        async first() {
          log.push({ sql, binds: this._binds, kind: "first" });
          const v = resolve(sql, this._binds, "first");
          return v === undefined ? null : v;
        },
        async all() {
          log.push({ sql, binds: this._binds, kind: "all" });
          const v = resolve(sql, this._binds, "all");
          return v === undefined ? { results: [] } : v;
        },
        async run() {
          log.push({ sql, binds: this._binds, kind: "run" });
          const v = resolve(sql, this._binds, "run");
          return v === undefined ? { meta: { changes: 1, last_row_id: 1 } } : v;
        }
      };
      return stmt;
    },
    async batch(stmts) {
      for (const s of stmts) log.push({ sql: s._sql, binds: s._binds, kind: "batch" });
      return stmts.map(() => ({ meta: { changes: 1 } }));
    }
  };
}

async function runTests() {
  // ── ١. attemptGuard: قفل بعد ٥ محاولات فاشلة ─────────────────────────────
  {
    const { attemptGuard, isLoginLocked, recordLoginFailure, recordResetOtpFailure } =
      await import("../functions/_lib/domain/auth.js");

    // سياسة "lockout" (تسجيل الدخول): أربع محاولات لا تقفل، والخامسة تختم locked_until.
    let count = 0;
    const log = [];
    const db = fakeDb(
      [
        [/SELECT failed_count FROM login_attempts WHERE email = \?$/, () => ({ failed_count: count })],
        [/INSERT INTO login_attempts/, () => { count += 1; return { meta: { changes: 1 } }; }]
      ],
      log
    );
    const env = { DB: db };
    for (let i = 0; i < 4; i++) await recordLoginFailure(env, "a@b.com");
    assert(
      !log.some((e) => /SET locked_until/.test(e.sql)),
      "DOM-1: أربع محاولات فاشلة لا تقفل الحساب"
    );
    await recordLoginFailure(env, "a@b.com");
    const lockRow = log.find((e) => /SET locked_until/.test(e.sql));
    assert(
      Boolean(lockRow) && lockRow.binds[0] === 15 && lockRow.binds[1] === "a@b.com",
      "DOM-2: المحاولة الخامسة تقفل ١٥ دقيقة على نفس البريد (attemptGuard سياسة lockout)"
    );

    // القفل يُقرأ من locked_until لا من العدّاد.
    const future = new Date(Date.now() + 60_000).toISOString().replace("T", " ").slice(0, 19);
    const past = new Date(Date.now() - 60_000).toISOString().replace("T", " ").slice(0, 19);
    const lockedEnv = { DB: fakeDb([[/SELECT locked_until/, { locked_until: future }]]) };
    const freeEnv = { DB: fakeDb([[/SELECT locked_until/, { locked_until: past }]]) };
    assert(await isLoginLocked(lockedEnv, "a@b.com"), "DOM-3: ختم قفل مستقبلي ⇒ مقفول");
    assert(!(await isLoginLocked(freeEnv, "a@b.com")), "DOM-4: ختم قفل منتهٍ ⇒ غير مقفول");

    // سياسة "window" (رمز الاستعادة): المفتاح موسوم بـpwreset: — لا يقفل الدخول،
    // وبلوغ العتبة يحرق الرمز المعلّق.
    const rlog = [];
    const rdb = fakeDb(
      [
        [/SELECT failed_count FROM login_attempts WHERE email = \?$/, { failed_count: 5 }],
        [/INSERT INTO login_attempts/, { meta: { changes: 1 } }]
      ],
      rlog
    );
    const burned = await recordResetOtpFailure({ DB: rdb }, "a@b.com");
    assert(
      burned === true && rlog.some((e) => /DELETE FROM password_resets/.test(e.sql) && e.binds[0] === "a@b.com"),
      "DOM-5: بلوغ العتبة بمسار الاستعادة يحرق الرمز المعلّق ويعيد true"
    );
    assert(
      rlog.every((e) => !/login_attempts/.test(e.sql) || String(e.binds[0]).startsWith("pwreset:")),
      "DOM-6: مفتاح الاستعادة موسوم بـ`pwreset:` — قفل الاستعادة لا يقفل تسجيل الدخول"
    );

    // المصنع نفسه قابل لإعادة الاستخدام بأي بادئة، بلا تكرار الخوارزمية.
    const g = attemptGuard({ prefix: "x:", policy: "lockout" });
    assert(g.key("a@b.com") === "x:a@b.com", "DOM-7: attemptGuard يشتق المفتاح من البادئة");
  }

  // ── ٢. قفل تجديد توكن سلة ────────────────────────────────────────────────
  {
    const { getValidSallaToken, acquireRefreshLock } = await import("../functions/_lib/domain/salla.js");
    const expired = Math.floor(Date.now() / 1000) - 10;

    // القفل ذرّي: UPDATE مشروط بـrefresh_lock = 0 أو قفل بائت (>٦٠ث).
    const lockLog = [];
    const lockDb = fakeDb([[/UPDATE oauth_tokens SET refresh_lock = 1/, { meta: { changes: 0 } }]], lockLog);
    const won = await acquireRefreshLock({ DB: lockDb }, "m_a", "salla");
    assert(
      won === false && /refresh_lock = 0 OR updated_at < datetime\('now', '-60 seconds'\)/.test(lockLog[0].sql),
      "DOM-8: acquireRefreshLock يخسر عند وجود قفل حيّ، ويسمح بسرقة قفل بائت (٦٠ث)"
    );

    // خاسر السباق ينتظر ثم يعيد القراءة؛ لو التوكن ما زال منتهياً يرمي بدل
    // تنفيذ تجديد موازٍ (توكن التجديد أحادي الاستخدام — التوازي يُبطل التفويض).
    const losingEnv = {
      DB: fakeDb([
        [/UPDATE oauth_tokens SET refresh_lock = 1/, { meta: { changes: 0 } }],
        [/SELECT \* FROM oauth_tokens/, { access_token: "t", refresh_token: "r", expires_at: expired }]
      ])
    };
    let thrown = null;
    try {
      await getValidSallaToken(losingEnv, "m_a");
    } catch (e) {
      thrown = e;
    }
    assert(
      /refresh in progress elsewhere/.test(String(thrown?.message)),
      "DOM-9: خاسر قفل التجديد لا يجدّد بالتوازي — يرمي ليعيد المحاولة"
    );

    // الفائز بالقفل: يستدعي المحوّل (HTTP خالص)، يحفظ، ثم يحرّر القفل دائماً.
    const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const winLog = [];
    let saved = { access_token: "old", refresh_token: "r1", expires_at: expired };
    const winDb = fakeDb(
      [
        [/UPDATE oauth_tokens SET refresh_lock = 1/, { meta: { changes: 1 } }],
        [/SELECT \* FROM oauth_tokens/, () => saved],
        [/INSERT INTO oauth_tokens/, () => { saved = { access_token: "NEW", refresh_token: "r2", expires_at: expired + 999999 }; return { meta: { changes: 1 } }; }]
      ],
      winLog
    );
    const realFetch = globalThis.fetch;
    let tokenUrl = null;
    globalThis.fetch = async (url) => {
      tokenUrl = String(url);
      return { ok: true, json: async () => ({ access_token: "NEW", refresh_token: "r2", expires_in: 1209600 }) };
    };
    let token = null;
    try {
      token = await getValidSallaToken({ DB: winDb, ENCRYPTION_KEY: key, SALLA_CLIENT_ID: "id", SALLA_CLIENT_SECRET: "sec" }, "m_a");
    } finally {
      globalThis.fetch = realFetch;
    }
    assert(token === "NEW", "DOM-10: الفائز بالقفل يجدّد التوكن ويعيد الجديد");
    assert(
      tokenUrl === "https://accounts.salla.sa/oauth2/token",
      "DOM-11: التجديد يمر بمحوّل HTTP الخالص على مضيف سلة المسموح فقط"
    );
    assert(
      winLog.some((e) => /SET refresh_lock = 0 WHERE merchant_id/.test(e.sql)),
      "DOM-12: القفل يُحرَّر بـfinally حتى لا يعلق التاجر بقفل يتيم"
    );
  }

  // ── ٣. نافذة واتساب ٢٤ ساعة ──────────────────────────────────────────────
  {
    const { isWaWindowOpen, recordWaInbound } = await import("../functions/_lib/domain/whatsapp.js");
    const stamp = (msAgo) => new Date(Date.now() - msAgo).toISOString().replace("T", " ").slice(0, 19);

    const open = { DB: fakeDb([[/SELECT last_inbound_at/, { last_inbound_at: stamp(23 * 3600 * 1000) }]]) };
    const shut = { DB: fakeDb([[/SELECT last_inbound_at/, { last_inbound_at: stamp(25 * 3600 * 1000) }]]) };
    const never = { DB: fakeDb([[/SELECT last_inbound_at/, null]]) };
    assert(await isWaWindowOpen(open, "m_a", "9665"), "DOM-13: آخر رسالة واردة قبل ٢٣ ساعة ⇒ النافذة مفتوحة");
    assert(!(await isWaWindowOpen(shut, "m_a", "9665")), "DOM-14: آخر رسالة واردة قبل ٢٥ ساعة ⇒ النافذة مغلقة");
    assert(!(await isWaWindowOpen(never, "m_a", "9665")), "DOM-15: بلا رسالة واردة إطلاقاً ⇒ النافذة مغلقة (fail closed)");

    const wlog = [];
    await isWaWindowOpen({ DB: fakeDb([], wlog) }, "m_a", "9665");
    assert(
      /merchant_id = \? AND phone = \?/.test(wlog[0].sql) && wlog[0].binds[0] === "m_a",
      "DOM-16: قراءة النافذة مشروطة بـmerchant_id — نافذة تاجر لا تُقرأ من حساب آخر"
    );

    // الوارد يجدّد الختم بنفس المتجر ويكتب الرسالة معزولة.
    const ilog = [];
    await recordWaInbound({ DB: fakeDb([], ilog) }, { merchantId: "m_a", phone: "9665", name: "س", body: "مرحبا" });
    assert(
      ilog.some((e) => /INSERT INTO whatsapp_contacts/.test(e.sql) && /last_inbound_at = datetime\('now'\)/.test(e.sql) && e.binds[0] === "m_a") &&
        ilog.some((e) => /INSERT INTO whatsapp_messages/.test(e.sql) && e.binds[0] === "m_a"),
      "DOM-17: recordWaInbound يجدّد ختم النافذة ويسجّل الرسالة بنفس merchant_id"
    );
  }

  // ── ٤. إحياء الصفوف المؤجَّلة (bulk) ─────────────────────────────────────
  {
    const { reviveDeferredItems, DEFERRED_MARKER, listMerchantsWithDeferredItems } =
      await import("../functions/_lib/domain/bulk.js");

    const rows = [
      { id: 1, job_id: "j1" },
      { id: 2, job_id: "j1" },
      { id: 3, job_id: "j2" }
    ];
    const log = [];
    const env = { DB: fakeDb([[/SELECT i\.id AS id, i\.job_id AS job_id/, { results: rows }]], log) };

    const revived = await reviveDeferredItems(env, { merchantId: "m_a", limit: 10 });
    assert(revived === 3, "DOM-18: يعيد عدد الصفوف التي أُحييت فعلاً");

    const select = log.find((e) => /SELECT i\.id AS id/.test(e.sql));
    assert(
      /j\.merchant_id = \?/.test(select.sql) && select.binds[0] === "m_a" && select.binds[1] === DEFERRED_MARKER,
      "DOM-19: اختيار المؤجَّل معزول بـmerchant_id وبعلامة التأجيل نفسها"
    );

    const items = log.filter((e) => /UPDATE bulk_job_items SET status = 'pending'/.test(e.sql));
    assert(items.length === 3 && items.every((e) => /error = NULL/.test(e.sql)), "DOM-20: كل صف مؤجَّل يعود pending وسبب التأجيل يُمحى");

    const jobs = log.filter((e) => /UPDATE bulk_jobs SET status = 'running'/.test(e.sql));
    assert(
      jobs.length === 2 &&
        jobs.every((e) => /WHERE id = \? AND merchant_id = \?/.test(e.sql) && e.binds[3] === "m_a"),
      "DOM-21: عدّادات الوظيفة تُعاد بشرط merchant_id — لا يُفتح طابور تاجر آخر"
    );
    const j1 = jobs.find((e) => e.binds[2] === "j1");
    assert(j1.binds[0] === 2 && j1.binds[1] === 2, "DOM-22: خصم processed/failed بعدد صفوف كل وظيفة لا بالمجموع");

    assert((await reviveDeferredItems(env, { merchantId: "m_a", limit: 0 })) === 0, "DOM-23: حصة متبقية صفر ⇒ لا إحياء ولا استعلام");

    const dlog = [];
    await listMerchantsWithDeferredItems({ DB: fakeDb([], dlog) }, 20);
    assert(
      dlog[0].binds[0] === DEFERRED_MARKER && dlog[0].binds[1] === 20,
      "DOM-24: مسح الـcron للمؤجَّل يطابق العلامة نفسها ويحترم الحد"
    );
  }

  // ── ٥. DomainError يُترجَم بـwithApi كما يُترجَم ApiError ─────────────────
  {
    const { DomainError } = await import("../functions/_lib/core/errors.js");
    const { withApi, ApiError } = await import("../functions/_lib/core/respond.js");

    const env = { SESSION_SECRET: "x".repeat(40) };
    const req = () =>
      new Request("https://hala-ai-os.pages.dev/api/t", {
        method: "POST",
        headers: { origin: "https://hala-ai-os.pages.dev", "content-type": "application/json" },
        body: "{}"
      });

    const domainRes = await withApi(() => {
      throw new DomainError(404, "العنصر غير موجود أو تمت مراجعته مسبقاً.", "REVIEW_NOT_PENDING", "internal detail");
    })({ request: req(), env });
    const apiRes = await withApi(() => {
      throw new ApiError(404, "العنصر غير موجود أو تمت مراجعته مسبقاً.", "REVIEW_NOT_PENDING", "internal detail");
    })({ request: req(), env });

    const d = await domainRes.json();
    const a = await apiRes.json();
    assert(domainRes.status === 404 && domainRes.status === apiRes.status, "DOM-25: DomainError يعطي نفس حالة ApiError");
    assert(
      d.ok === false && d.error === a.error && d.code === a.code,
      "DOM-26: جسم الاستجابة مطابق حرفياً لما يعطيه ApiError (نفس الرسالة العربية ونفس الكود)"
    );
    assert(typeof d.requestId === "string" && d.requestId.length > 0, "DOM-27: DomainError يحمل requestId مثل غيره");
    assert(
      !JSON.stringify(d).includes("internal detail"),
      "DOM-28: `internal` لا يتسرّب للعميل — للسجل فقط"
    );
    assertLib.deepStrictEqual(Object.keys(d).sort(), Object.keys(a).sort());
    assert(true, "DOM-29: نفس مفاتيح الجسم بالضبط بين المسارين");

    // المجال لا يستورد respond.js: DomainError معرَّف بـcore/errors.js ويحمل
    // العقد الكامل {status, code, userMessage, internal}.
    const de = new DomainError(400, "رسالة", "CODE", "detail");
    assert(
      de.status === 400 && de.code === "CODE" && de.userMessage === "رسالة" && de.message === "رسالة" && de.internal === "detail",
      "DOM-30: عقد DomainError {status, code, userMessage, internal} كامل"
    );
  }

  console.log(`\n${passed}/${total} tests passed.`);
  if (passed !== total) process.exit(1);
}

runTests().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});

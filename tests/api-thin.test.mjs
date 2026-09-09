// tests/api-thin.test.mjs — المرحلة ٤ (النصف أ): «نقاط الدخول تنسيق فقط».
//
// كل اختبار هنا **سلوكي**: يستدعي المعالج المُصدَّر فعلاً بـ`Request` حقيقي
// وبيئة مزيَّفة (D1 · KV · بريد · واتساب)، ويقيس **الحالة والرسالة والكوكي** —
// لا نص الملفات. هذه هي الشبكة التي تثبت أن نقل SQL إلى `domain/*` وتحويل
// المعالجات الخام إلى `withApi` لم يغيّر شيئاً يراه العميل.
//
// التغطية:
//   بوابة الـcron  — بلا سر ٥٠٠ · سر خاطئ ٤٠١ · السر الصحيح يمرّ
//   auth           — signup · login · logout · me · complete_account ·
//                    verify_email (نفس الحالات والرسائل والكوكي قبل/بعد)
//   CSRF           — withApi يرفض أصلاً غير موثوق قبل تنفيذ المعالج
//   cron/reminders — الفتحة والاستحقاق والتذكير وختم reminder_sent_at
//   stats/health   — أرقام حقيقية · ٥٠٣ عند سقوط فحص حرج
import { withApi } from "../functions/_lib/core/respond.js";
import { createSessionToken } from "../functions/_lib/core/session.js";
import { hashPassword } from "../functions/_lib/core/auth.js";

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

const SECRET = "test-secret-12345";

/** KV وهمي كافٍ لـcheckRateLimit وأختام التنبيه. */
function mockKv() {
  const store = new Map();
  return {
    store,
    async get(k) {
      return store.has(k) ? store.get(k) : null;
    },
    async put(k, v) {
      store.set(k, v);
    },
    async delete(k) {
      store.delete(k);
    }
  };
}

/**
 * D1 وهمي موجَّه بالتعبير: `[{ match: /SQL/, first?, all?, run? }]`.
 * كل استعلام يُسجَّل بـ`db.sql` للتحقق من أن الشرط (merchant_id مثلاً) بقي.
 */
function mockDb(routes = []) {
  const sql = [];
  const binds = [];
  const pick = (q) => routes.find((r) => r.match.test(q));
  const db = {
    sql,
    binds,
    prepare(q) {
      sql.push(q);
      const route = pick(q);
      const stmt = {
        bind(...args) {
          binds.push(args);
          return stmt;
        },
        async first() {
          return typeof route?.first === "function" ? route.first(binds.at(-1) || []) : (route?.first ?? null);
        },
        async all() {
          const rows = typeof route?.all === "function" ? route.all(binds.at(-1) || []) : route?.all;
          return { results: rows ?? [] };
        },
        async run() {
          if (route?.run) route.run(binds.at(-1) || []);
          return { meta: { last_row_id: route?.lastRowId ?? 1 } };
        }
      };
      return stmt;
    },
    async batch(stmts) {
      for (const s of stmts) await s.run();
      return [];
    }
  };
  return db;
}

const ctx = (request, env) => ({ request, env, waitUntil: (p) => p });

function post(url, body, headers = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://hala-ai-os.pages.dev", ...headers },
    body: JSON.stringify(body || {})
  });
}

async function runTests() {
  console.log("api-thin (المرحلة ٤ — النصف أ) — starting...\n");

  // ── بوابة الـcron الموحّدة (withApi.raw({cron:true})) ──────────────────────
  {
    let ran = 0;
    const guarded = withApi.raw(async () => {
      ran += 1;
      return { ok: true, did: "work" };
    }, { csrf: false, cron: true, cronMessage: "الوظيفة غير مفعّلة.", logPath: "cron/test" });

    const get = (auth) => new Request("https://x.test/api/cron/test", auth ? { headers: { Authorization: auth } } : {});

    const noSecret = await guarded(ctx(get("Bearer whatever"), {}));
    const noSecretBody = await noSecret.json();
    assert(
      noSecret.status === 500 && noSecretBody.code === "CRON_NOT_CONFIGURED" && noSecretBody.error === "الوظيفة غير مفعّلة." && ran === 0,
      "CRON-1: بلا CRON_SECRET ⇒ ٥٠٠ CRON_NOT_CONFIGURED برسالة عربية، والمعالج لا يعمل (fail closed)"
    );

    const wrong = await guarded(ctx(get("Bearer nope"), { CRON_SECRET: "right-secret" }));
    const wrongBody = await wrong.json();
    assert(
      wrong.status === 401 && wrongBody.code === "UNAUTHORIZED" && wrongBody.error === "غير مصرّح بهذا الطلب." && ran === 0,
      "CRON-2: سر خاطئ ⇒ ٤٠١ UNAUTHORIZED، والمعالج لا يعمل"
    );

    const missingHeader = await guarded(ctx(get(null), { CRON_SECRET: "right-secret" }));
    assert(missingHeader.status === 401 && ran === 0, "CRON-3: بلا ترويسة Authorization ⇒ ٤٠١");

    const ok = await guarded(ctx(get("Bearer right-secret"), { CRON_SECRET: "right-secret" }));
    const okBody = await ok.json();
    assert(ok.status === 200 && okBody.did === "work" && ran === 1, "CRON-4: السر الصحيح يمرّ للمعالج");
    assert(Boolean(ok.headers.get("X-Request-Id")), "CRON-5: كل رد يحمل X-Request-Id مثل withApi");

    const dbless = await guarded(ctx(get("Bearer right-secret"), { CRON_SECRET: "right-secret" }));
    assert(dbless.status === 200, "CRON-6: بلا requireDb لا يُشترط env.DB");

    const needsDb = withApi.raw(async () => ({ ok: true }), {
      csrf: false, cron: true, requireDb: true, cronMessage: "الوظيفة غير مفعّلة.", logPath: "cron/test"
    });
    const noDb = await needsDb(ctx(get("Bearer right-secret"), { CRON_SECRET: "right-secret" }));
    assert((await noDb.json()).code === "CRON_NOT_CONFIGURED" && noDb.status === 500, "CRON-7: requireDb مع غياب DB ⇒ ٥٠٠ لا نجاح كاذب");
  }

  // ── CSRF: withApi يحرس المعالجات التي كانت خاماً ───────────────────────────
  {
    const { onRequestPost: signup } = await import("../functions/api/auth/signup.js");
    const evil = new Request("https://hala-ai-os.pages.dev/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ email: "a@b.com", password: "12345678" })
    });
    const res = await signup(ctx(evil, { SESSION_SECRET: SECRET, HALA_CACHE: mockKv(), DB: mockDb() }));
    const body = await res.json();
    assert(
      res.status === 403 && body.code === "CSRF_REJECTED" && /مصدر غير موثوق/.test(body.error),
      "CSRF-1: signup (كان معالجاً خاماً) يرفض أصلاً غير موثوق ٤٠٣ بنفس الرسالة"
    );
  }

  // ── auth/signup ────────────────────────────────────────────────────────────
  {
    const { onRequestPost: signup } = await import("../functions/api/auth/signup.js");
    const inserted = [];
    const env = {
      SESSION_SECRET: SECRET,
      ADMIN_EMAILS: "boss@aura.sa",
      HALA_CACHE: mockKv(),
      DB: mockDb([
        { match: /SELECT email FROM accounts/, all: () => [] },
        { match: /INSERT INTO merchants/, run: (b) => inserted.push(b) },
        { match: /INSERT INTO accounts/, run: (b) => inserted.push(b) }
      ])
    };

    const bad = await signup(ctx(post("https://hala-ai-os.pages.dev/api/auth/signup", { email: "nope", password: "12345678" }), env));
    assert(bad.status === 400 && (await bad.json()).error === "أدخل بريد إلكتروني صحيح.", "AUTH-1: بريد غير صالح ⇒ ٤٠٠ بنفس النص");

    const shortPw = await signup(ctx(post("https://hala-ai-os.pages.dev/api/auth/signup", { email: "a@b.com", password: "123" }), env));
    assert(shortPw.status === 400 && (await shortPw.json()).error === "كلمة المرور لازم تكون ٨ أحرف على الأقل.", "AUTH-2: كلمة مرور قصيرة ⇒ ٤٠٠ بنفس النص");

    const adminEnv = { ...env, HALA_CACHE: mockKv() };
    const adminTry = await signup(ctx(post("https://hala-ai-os.pages.dev/api/auth/signup", { email: "boss@aura.sa", password: "12345678" }), adminEnv));
    assert(
      adminTry.status === 409 && (await adminTry.json()).error === "هذا البريد مسجّل مسبقاً — سجّل دخول بدل ذلك.",
      "AUTH-3 (P38): عنوان ADMIN_EMAILS يُرفض ٤٠٩ برسالة عامة (لا تعداد)"
    );

    const okEnv = { ...env, HALA_CACHE: mockKv() };
    const ok = await signup(ctx(post("https://hala-ai-os.pages.dev/api/auth/signup", { email: "new@shop.com", password: "12345678" }), okEnv));
    const okBody = await ok.json();
    assert(
      ok.status === 200 && okBody.ok === true && okBody.email === "new@shop.com" && /^m_/.test(okBody.storeId),
      "AUTH-4: تسجيل ناجح يرجّع storeId وبريداً"
    );
    assert(/^hala_session=/.test(ok.headers.get("Set-Cookie") || ""), "AUTH-5: كوكي الجلسة يُضبط كما كان (withApi يمرّر Response كما هو)");
    assert(inserted.length === 2, "AUTH-6: صفّا merchants وaccounts يُكتبان (عبر domain/accounts.js)");

    const dupEnv = {
      ...env,
      HALA_CACHE: mockKv(),
      DB: mockDb([{ match: /SELECT email FROM accounts/, all: () => [{ email: "new@shop.com" }] }])
    };
    const dup = await signup(ctx(post("https://hala-ai-os.pages.dev/api/auth/signup", { email: "new+tag@shop.com", password: "12345678" }), dupEnv));
    assert(dup.status === 409, "AUTH-7 (P59): التطبيع يمسك صيغة بديلة لنفس البريد ⇒ ٤٠٩");
  }

  // ── auth/login ─────────────────────────────────────────────────────────────
  {
    const { onRequestPost: login } = await import("../functions/api/auth/login.js");
    const { hash, salt } = await hashPassword("correct-horse");
    const account = { merchant_id: "m_abc", email: "m@shop.com", password_hash: hash, password_salt: salt, disabled: 0 };
    const routes = [
      { match: /SELECT \* FROM accounts WHERE email/, first: () => account },
      { match: /SELECT locked_until FROM login_attempts/, first: () => null },
      { match: /SELECT disabled FROM accounts/, first: () => ({ disabled: 0 }) },
      { match: /SELECT store_name FROM merchants/, first: () => ({ store_name: "متجر الاختبار" }) },
      { match: /login_attempts/, first: () => null }
    ];
    const env = () => ({ SESSION_SECRET: SECRET, HALA_CACHE: mockKv(), DB: mockDb(routes) });

    const wrong = await login(ctx(post("https://hala-ai-os.pages.dev/api/auth/login", { email: "m@shop.com", password: "nope" }), env()));
    assert(wrong.status === 401 && (await wrong.json()).error === "البريد أو كلمة المرور غير صحيحة.", "AUTH-8: كلمة مرور خاطئة ⇒ ٤٠١ بنفس النص");

    const ok = await login(ctx(post("https://hala-ai-os.pages.dev/api/auth/login", { email: "m@shop.com", password: "correct-horse" }), env()));
    const okBody = await ok.json();
    assert(
      ok.status === 200 && okBody.storeId === "m_abc" && okBody.storeName === "متجر الاختبار" && okBody.isAdmin === false,
      "AUTH-9: دخول ناجح يرجّع storeId واسم المتجر من domain/accounts.js"
    );
    assert(/^hala_session=/.test(ok.headers.get("Set-Cookie") || ""), "AUTH-10: كوكي الجلسة يُضبط عند الدخول");

    // بلا بريد لا يمرّ فحص القفل (يحتاج D1) فنصل لحارس غياب DB نفسه.
    const noDb = await login(ctx(post("https://hala-ai-os.pages.dev/api/auth/login", { password: "x" }), { SESSION_SECRET: SECRET, HALA_CACHE: mockKv() }));
    assert(noDb.status === 503 && (await noDb.json()).error === "الخدمة غير متاحة حالياً — حاول بعد قليل.", "AUTH-11 (Q2): غياب DB ٥٠٣ لا 'حساب غير موجود'");

    const disabledEnv = {
      SESSION_SECRET: SECRET,
      HALA_CACHE: mockKv(),
      DB: mockDb([...routes.slice(0, 2), { match: /SELECT disabled FROM accounts/, first: () => ({ disabled: 1 }) }, ...routes.slice(3)])
    };
    const disabled = await login(ctx(post("https://hala-ai-os.pages.dev/api/auth/login", { email: "m@shop.com", password: "correct-horse" }), disabledEnv));
    assert(disabled.status === 403 && (await disabled.json()).error === "هذا الحساب معطّل. تواصل مع فريق هالة.", "AUTH-12: حساب معطّل ⇒ ٤٠٣ بنفس النص");
  }

  // ── auth/logout · auth/me ──────────────────────────────────────────────────
  {
    const { onRequestPost: logout } = await import("../functions/api/auth/logout.js");
    const { onRequestPost: me } = await import("../functions/api/auth/me.js");

    const bumped = [];
    const env = {
      SESSION_SECRET: SECRET,
      HALA_CACHE: mockKv(),
      DB: mockDb([
        { match: /session_version/, run: (b) => bumped.push(b), first: () => ({ session_version: 0 }) },
        { match: /SELECT email FROM accounts/, first: () => ({ email: "m@shop.com" }) },
        { match: /SELECT store_name FROM merchants/, first: () => ({ store_name: "متجر الاختبار" }) }
      ])
    };

    const out = await logout(ctx(post("https://hala-ai-os.pages.dev/api/auth/logout", {}), env));
    const outBody = await out.json();
    assert(out.status === 200 && outBody.ok === true, "AUTH-13: الخروج يرجّع ok دائماً");
    assert(/^hala_session=;?/.test(out.headers.get("Set-Cookie") || "") || /hala_session=/.test(out.headers.get("Set-Cookie") || ""), "AUTH-14: الخروج يمسح الكوكي");

    const anon = await me(ctx(post("https://hala-ai-os.pages.dev/api/auth/me", {}), env));
    assert((await anon.json()).loggedIn === false, "AUTH-15: /me بلا جلسة ⇒ loggedIn:false");

    const token = await createSessionToken(env, "m_abc");
    const signed = await me(ctx(post("https://hala-ai-os.pages.dev/api/auth/me", {}, { cookie: `hala_session=${encodeURIComponent(token)}` }), env));
    const signedBody = await signed.json();
    assert(
      signedBody.loggedIn === true && signedBody.storeId === "m_abc" && signedBody.email === "m@shop.com" && signedBody.storeName === "متجر الاختبار",
      "AUTH-16: /me بجلسة يرجّع البريد واسم المتجر (من domain/accounts.js)"
    );
  }

  // ── auth/complete_account ──────────────────────────────────────────────────
  {
    const { onRequestPost: complete } = await import("../functions/api/auth/complete_account.js");
    const mk = (routes) => ({ SESSION_SECRET: SECRET, HALA_CACHE: mockKv(), DB: mockDb(routes) });

    const baseRoutes = [
      { match: /SELECT id FROM merchants WHERE id/, first: () => ({ id: "m_salla" }) },
      { match: /SELECT email FROM accounts WHERE merchant_id/, first: () => null },
      { match: /SELECT merchant_id FROM accounts WHERE email/, first: () => null },
      { match: /INSERT INTO accounts/, run: () => {} }
    ];

    const anon = await complete(ctx(post("https://hala-ai-os.pages.dev/api/auth/complete_account", { email: "a@b.com", password: "12345678" }), mk(baseRoutes)));
    assert(anon.status === 401 && (await anon.json()).code === "LOGIN_REQUIRED", "AUTH-17: بلا جلسة ⇒ ٤٠١ LOGIN_REQUIRED");

    const env = mk(baseRoutes);
    const token = await createSessionToken(env, "m_salla");
    const cookie = { cookie: `hala_session=${encodeURIComponent(token)}` };

    const ok = await complete(ctx(post("https://hala-ai-os.pages.dev/api/auth/complete_account", { email: "a@b.com", password: "12345678" }, cookie), env));
    const okBody = await ok.json();
    assert(ok.status === 200 && okBody.storeId === "m_salla" && okBody.email === "a@b.com", "AUTH-18: إكمال الحساب ينجح بمعرّف الجلسة لا بالجسم");

    const takenEnv = mk([
      baseRoutes[0],
      baseRoutes[1],
      { match: /SELECT merchant_id FROM accounts WHERE email/, first: () => ({ merchant_id: "m_other" }) }
    ]);
    const takenTok = await createSessionToken(takenEnv, "m_salla");
    const taken = await complete(ctx(post("https://hala-ai-os.pages.dev/api/auth/complete_account", { email: "a@b.com", password: "12345678" }, { cookie: `hala_session=${encodeURIComponent(takenTok)}` }), takenEnv));
    assert(taken.status === 409 && (await taken.json()).error === "هذا البريد مسجّل مسبقاً — سجّل دخول بدل ذلك.", "AUTH-19: بريد مأخوذ ⇒ ٤٠٩ بنفس النص");

    const ghostEnv = mk([{ match: /SELECT id FROM merchants WHERE id/, first: () => null }]);
    const ghostTok = await createSessionToken(ghostEnv, "m_ghost");
    const ghost = await complete(ctx(post("https://hala-ai-os.pages.dev/api/auth/complete_account", { email: "a@b.com", password: "12345678" }, { cookie: `hala_session=${encodeURIComponent(ghostTok)}` }), ghostEnv));
    assert(ghost.status === 404 && (await ghost.json()).code === "MERCHANT_NOT_FOUND", "AUTH-20: متجر غير موجود ⇒ ٤٠٤ (لا حساب يتيم)");
  }

  // ── auth/verify_email — العدّ ذرّي، والحرق بعد ٥ ──────────────────────────
  {
    const { onRequestPost: verify } = await import("../functions/api/auth/verify_email.js");
    const { hashVerificationCode } = await import("../functions/_lib/domain/auth.js");
    const codeHash = await hashVerificationCode("m@shop.com", "123456");
    let attempts = 0;
    const burned = [];
    const env = {
      SESSION_SECRET: SECRET,
      HALA_CACHE: mockKv(),
      DB: mockDb([
        { match: /SELECT email, email_verified_at FROM accounts/, first: () => ({ email: "m@shop.com", email_verified_at: null }) },
        { match: /UPDATE email_verifications SET attempts/, first: () => ({ code_hash: codeHash, attempts: ++attempts }) },
        { match: /DELETE FROM email_verifications/, run: () => burned.push(1) },
        { match: /UPDATE accounts SET email_verified_at/, run: () => {} }
      ])
    };
    const token = await createSessionToken(env, "m_abc");
    const cookie = { cookie: `hala_session=${encodeURIComponent(token)}` };
    const call = (code) => verify(ctx(post("https://hala-ai-os.pages.dev/api/auth/verify_email", { code }, cookie), env));

    const shortCode = await call("12");
    assert(shortCode.status === 400 && (await shortCode.json()).error === "أدخل رمز التحقق المكوّن من ٦ أرقام.", "AUTH-21: رمز غير سداسي ⇒ ٤٠٠ بنفس النص");

    const wrong = await call("999999");
    assert(wrong.status === 400 && (await wrong.json()).code === "CODE_INVALID", "AUTH-22: رمز خاطئ ⇒ ٤٠٠ CODE_INVALID");

    attempts = 5; // المحاولة التالية تتجاوز MAX_ATTEMPTS
    const burnedRes = await call("999999");
    assert(burnedRes.status === 400 && (await burnedRes.json()).code === "CODE_BURNED" && burned.length > 0, "AUTH-23: تجاوز ٥ محاولات يحرق الرمز ⇒ CODE_BURNED");

    attempts = 0;
    const ok = await call("123456");
    assert(ok.status === 200 && (await ok.json()).ok === true, "AUTH-24: الرمز الصحيح يختم البريد متحقَّقاً");
  }

  // ── cron/reminders — الفتحة والاستحقاق والختم ─────────────────────────────
  {
    const { targetSlotLabel, dueReminders, ticketOf } = await import("../functions/_lib/domain/booking.js");

    // الجمعة ١٠ص بتوقيت الرياض ⇒ خارج الفتحات (WEEKLY_SLOTS تبدأ الأحد).
    const friday = Date.parse("2026-09-11T06:00:00Z"); // ٩ص الرياض جمعة
    assert(targetSlotLabel(friday) === null, "REM-1: الجمعة خارج الفتحات ⇒ null (لا تذكير)");

    const sunday = Date.parse("2026-09-13T06:30:00Z"); // ١٠ص الرياض أحد بعد ٣٠ دقيقة
    assert(typeof targetSlotLabel(sunday) === "string" && targetSlotLabel(sunday).startsWith("الأحد"), "REM-2: يوم عمل ⇒ تسمية فتحة تبدأ باليوم");

    let dueSql = "";
    const db = mockDb([
      {
        match: /FROM consultation_bookings/,
        all: () => [{ id: 7, ticket_code: "AURA-00007", name: "سارة", phone: "966500000001", preferred_slot_label: "الأحد ١٠ص" }]
      }
    ]);
    const rows = await dueReminders({ DB: db }, "الأحد ١٠ص");
    dueSql = db.sql.join(" ");
    assert(rows.length === 1 && rows[0].id === 7, "REM-3: dueReminders يرجّع الحجوزات المستحقة للفتحة");
    assert(/reminder_sent_at IS NULL/.test(dueSql) && /preferred_slot_label = \?/.test(dueSql), "REM-4: الاستعلام يمنع التكرار بـreminder_sent_at ويقيّد بالفتحة");
    assert(ticketOf(rows[0]) === "AURA-00007", "REM-5 (P18): رقم التذكرة من العمود لا من إعادة الحساب");
    assert(ticketOf({ id: 9, ticket_code: null }) === "AURA-00009", "REM-6: الاشتقاق احتياطي لصفوف ما قبل الهجرة فقط");

    const { onRequestGet: reminders } = await import("../functions/api/cron/reminders.js");
    const marked = [];
    const env = {
      CRON_SECRET: "s3cr3t",
      DB: mockDb([
        { match: /FROM consultation_bookings\s/, all: () => [] },
        { match: /UPDATE consultation_bookings SET reminder_sent_at/, run: (b) => marked.push(b) }
      ])
    };
    const res = await reminders(ctx(new Request("https://x.test/api/cron/reminders", { headers: { Authorization: "Bearer s3cr3t" } }), env));
    const body = await res.json();
    assert(res.status === 200 && body.ok === true && body.remindersSent === 0, "REM-7: لا حجوزات مستحقة ⇒ ٢٠٠ بصفر تذكيرات (لا خطأ)");
  }

  // ── stats — أرقام حقيقية فقط، والجدول الناقص لا يُسقط النقطة ──────────────
  {
    const { onRequestPost: stats } = await import("../functions/api/stats.js");
    const env = {
      DB: mockDb([
        { match: /SUM\(total\)/, first: () => ({ v: 1500 }) },
        { match: /COUNT\(\*\) AS v FROM consultation_bookings/, first: () => ({ v: 12 }) },
        { match: /hala_cache/, first: () => null } // جدول ناقص ⇒ صفر لا ٥٠٠
      ])
    };
    const res = await stats(ctx(post("https://hala-ai-os.pages.dev/api/stats", {}), env));
    const body = await res.json();
    assert(res.status === 200 && body.recoveredSalesSAR === 1500 && body.consultationTickets === 12, "STATS-1: الأرقام الحقيقية تمرّ كما هي");
    assert(body.halaCacheSavingRate === 0, "STATS-2: استعلام فاشل ⇒ صفر صادق لا رقم مخترع ولا ٥٠٠");
  }

  // ── health — ٥٠٣ عند سقوط فحص حرج، ٢٠٠ عند السلامة ───────────────────────
  {
    const { onRequest: health } = await import("../functions/api/health.js");
    const req = new Request("https://x.test/api/health");

    const down = await health(ctx(req, {}));
    const downBody = await down.json();
    assert(down.status === 503 && downBody.status === "degraded" && downBody.checks.db === "missing", "HEALTH-1 (O1): فحص حرج ساقط ⇒ ٥٠٣ degraded");

    const upEnv = {
      DB: mockDb([{ match: /SELECT 1/, first: () => ({ 1: 1 }) }]),
      HALA_CACHE: mockKv(),
      AI: {},
      VECTORIZE_INDEX: {}
    };
    const up = await health(ctx(req, upEnv));
    const upBody = await up.json();
    assert(up.status === 200 && upBody.status === "ok" && upBody.checks.db === "ok" && upBody.checks.cache === "ok", "HEALTH-2: الفحوص الحرجة سليمة ⇒ ٢٠٠ ok");
    assert(upBody.checks.cron === "missing", "HEALTH-3 (O2): جدول النبض غير المطبَّق missing لا error");
  }

  console.log(`\n${passed}/${total} tests passed.`);
  if (passed !== total) process.exit(1);
}

runTests().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});

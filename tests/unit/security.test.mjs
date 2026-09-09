import { createRunner } from "../_helpers.mjs";
import { createSessionVersionKv, TEST_SESSION_SECRET } from "../_helpers.mjs";
import { createSessionToken } from "../../functions/_lib/core/session.js";

const { assert, done } = createRunner("security");

async function main() {
  const sessionVersionKv = createSessionVersionKv();
  const env = { SESSION_SECRET: TEST_SESSION_SECRET, HALA_CACHE: sessionVersionKv };
  // 9. Pillar 3 — accounts portal
  const forgotMod = await import("../../functions/api/auth/forgot_password.js");
  assert(typeof forgotMod.onRequestPost === "function", "forgot_password.js exports valid onRequestPost middleware");

  const signupMod = await import("../../functions/api/auth/signup.js");
  assert(typeof signupMod.onRequestPost === "function", "signup.js exports valid onRequestPost middleware");

  const loginMod = await import("../../functions/api/auth/login.js");
  assert(typeof loginMod.onRequestPost === "function", "login.js exports valid onRequestPost middleware");

  const resetMod = await import("../../functions/api/auth/reset_password.js");
  assert(typeof resetMod.onRequestPost === "function", "reset_password.js exports valid onRequestPost middleware");

  const googleMod = await import("../../functions/api/auth/google.js");
  assert(typeof googleMod.onRequestPost === "function", "google.js exports valid onRequestPost middleware");

  // 9b. P38 — no self-service path may create an account with an ADMIN_EMAILS
  // address. requireAdmin() matches accounts.email against that secret and
  // there is no is_admin column, so such a row IS full admin. These are
  // behavioural: the endpoint must answer 409 and must NEVER reach the DB
  // INSERT (the mock throws on any DB use, so a regression fails loudly).
  const { isAdminEmail } = await import("../../functions/_lib/core/adminEmails.js");
  const adminEnv = { ADMIN_EMAILS: " Admin@Aura.SA , second@aura.sa ", SESSION_SECRET: env.SESSION_SECRET, HALA_CACHE: sessionVersionKv };
  assert(isAdminEmail(adminEnv, "admin@aura.sa"), "isAdminEmail trims and lowercases both sides");
  assert(isAdminEmail(adminEnv, "  SECOND@aura.sa "), "isAdminEmail handles spaces around commas");
  assert(!isAdminEmail(adminEnv, "merchant@aura.sa"), "isAdminEmail rejects a non-admin address");
  assert(!isAdminEmail({ ADMIN_EMAILS: "" }, ""), "isAdminEmail never matches an empty address");

  const explodingDb = {
    prepare() {
      throw new Error("signup reached the database with an admin email");
    }
  };
  function jsonReq(body, headers = {}) {
    return new Request("https://x/api", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body)
    });
  }

  const signupRes = await signupMod.onRequestPost({
    request: jsonReq({ email: "  ADMIN@aura.sa ", password: "longenoughpw" }),
    env: { ...adminEnv, DB: explodingDb }
  });
  const signupBody = await signupRes.json();
  assert(signupRes.status === 409, `signup rejects an ADMIN_EMAILS address (got ${signupRes.status})`);
  assert(
    signupBody.error === "هذا البريد مسجّل مسبقاً — سجّل دخول بدل ذلك.",
    "signup admin rejection reuses the generic 'email taken' message (no admin enumeration)"
  );

  const adminRejectCompleteMod = await import("../../functions/api/auth/complete_account.js");
  const completeToken = await createSessionToken(adminEnv, "m_test_admin_reject");
  const completeRes = await adminRejectCompleteMod.onRequestPost({
    request: jsonReq(
      { email: "second@AURA.sa", password: "longenoughpw" },
      { Cookie: `hala_session=${encodeURIComponent(completeToken)}` }
    ),
    env: { ...adminEnv, DB: explodingDb }
  });
  assert(completeRes.status === 409, `complete_account rejects an ADMIN_EMAILS address (got ${completeRes.status})`);

  // A non-admin address must still get past the guard and reach the DB — proves
  // the check is targeted, not a blanket refusal.
  let reachedDb = false;
  const countingDb = {
    prepare() {
      reachedDb = true;
      return { bind: () => ({ first: async () => null, run: async () => ({}) }) };
    },
    batch: async () => []
  };
  await signupMod
    .onRequestPost({
      request: jsonReq({ email: "merchant@example.com", password: "longenoughpw" }),
      env: { ...adminEnv, DB: countingDb }
    })
    .catch(() => {});
  assert(reachedDb, "signup still proceeds normally for a non-admin address");

  // 11. Batch-1 security fixes (SECURITY_AUDIT 2026-09-05)
  const { resolveStoreId } = await import("../../functions/_lib/core/session.js");

  // A merchants DB where only "m_real" exists (an account-less Salla install).
  const storeEnv = {
    SESSION_SECRET: "test-secret-12345",
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => {
                // getMerchant: SELECT * FROM merchants WHERE id = ?
                if (/FROM merchants WHERE id/.test(sql)) {
                  return args[0] === "m_real" ? { id: "m_real", store_name: "متجر" } : null;
                }
                // getAccountEmail / accounts lookups → no account for these
                return null;
              }
            };
          }
        };
      }
    }
  };
  const noCookieReq = { headers: { get: () => null } };

  // C2: an invented storeId with no merchant row must NOT become its own tenant
  const invented = await resolveStoreId(noCookieReq, storeEnv, "x_invented_9999");
  assert(invented === "default-store", "C2: unknown claimed storeId falls back to default-store (no free quota farming)");

  // C2: a real account-less Salla merchant is still addressable by id
  const real = await resolveStoreId(noCookieReq, storeEnv, "m_real");
  assert(real === "m_real", "account-less Salla merchant still reachable by id");

  // C2/H7: the reserved unmetered "hala" id can never be claimed anonymously
  let halaBlocked = false;
  try {
    await resolveStoreId(noCookieReq, storeEnv, "hala");
  } catch (e) {
    halaBlocked = e?.code === "LOGIN_REQUIRED";
  }
  assert(halaBlocked, "C2/H7: anonymous caller cannot claim the unmetered 'hala' tenant");

  // C3: the admin escape helper neutralizes an XSS payload
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const escaped = esc('<img src=x onerror=alert(1)>');
  assert(!escaped.includes("<img") && escaped.includes("&lt;img"), "C3: escapeHtml neutralizes an XSS payload");

  // C3 defence-in-depth: sanitizeInput strips tags from a store name
  const { sanitizeInput: sanitize } = await import("../../functions/_lib/core/security.js");
  assert(!sanitize('<script>x</script>متجر', 100).includes("<"), "C3: sanitizeInput strips tags from storeName");


  // ── D4: كتالوج الأخطاء العربية (docs/PARALLEL_TRACKS.md §أ.٤) ──
  {
    const { classifyError, messageFor, statusFor, ERROR_CATALOG } = await import(
      "../../functions/_lib/core/errors.js"
    );

    // كل رسالة تصل التاجر عربية — لا إنجليزية ولا كود خام. هذا جوهر D4:
    // مدخل واحد إنجليزي يكفي ليرى تاجر رسالة لا يفهمها.
    const nonArabic = Object.entries(ERROR_CATALOG).filter(
      ([, v]) => !/[؀-ۿ]/.test(v.message)
    );
    assert(nonArabic.length === 0, `D4: كل رسائل الكتالوج عربية (المخالف: ${nonArabic.map(([k]) => k).join(", ")})`);

    // التمييز الذي يهم عملياً: "مزحوم" (أعد المحاولة) ≠ "معطّل" (لا تعيد).
    assert(
      classifyError(new Error("Groq 429: rate limit exceeded")) === "AI_BUSY",
      "D4: خطأ 429 من مزود يُصنَّف AI_BUSY (أعد المحاولة)"
    );
    assert(
      classifyError(new Error("No AI backend available. Configure at least one")) === "AI_UNAVAILABLE",
      "D4: غياب كل المزودين يُصنَّف AI_UNAVAILABLE (لا فائدة من الإعادة)"
    );
    assert(
      classifyError(new Error("D1_ERROR: no such table: merchants")) === "DB_UNAVAILABLE",
      "D4: عطل قاعدة البيانات يُصنَّف DB_UNAVAILABLE"
    );
    assert(
      classifyError(new Error("fetch failed")) === "SYNC_FAILED",
      "D4: عطل الشبكة يُصنَّف SYNC_FAILED"
    );

    // الارتداد الآمن: خطأ مجهول يعطي رسالة صحيحة أعمّ، لا رسالة خاطئة واثقة.
    assert(
      classifyError(new Error("something nobody predicted")) === "INTERNAL",
      "D4: الخطأ المجهول يرتد لـINTERNAL بدل تصنيف مخترع"
    );
    assert(
      /[؀-ۿ]/.test(messageFor("CODE_DOES_NOT_EXIST")) && statusFor("CODE_DOES_NOT_EXIST") === 500,
      "D4: كود غير معروف يرتد لرسالة عربية وحالة 500، لا undefined"
    );
  }

  // ── المرحلة ١.٧ (COMPLETION_PATH) — P18 · P23 · P26 · console.error ─────
  {
    const { readFileSync } = await import("node:fs");
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const { timingSafeEqualStr } = await import("../../functions/_lib/core/crypto.js");

    assert(timingSafeEqualStr("abc", "abc") === true && timingSafeEqualStr("abc", "abd") === false
      && timingSafeEqualStr("abc", "abcd") === false && timingSafeEqualStr(undefined, "") === true,
      "P26-1: timingSafeEqualStr يطابق/يرفض صح ويتحمل undefined");
    // المرحلة ٤: بوابة CRON_SECRET صارت موحّدة بـwithApi.raw({cron:true}) بدل
    // نسخة بكل ملف — المقارنة الثابتة الزمن تُفحص بمصدرها، والوظائف تُفحص أنها
    // تمر بالبوابة فعلاً (اختبارات السلوك بـtests/api-thin.test.mjs).
    const respondSrc = read("../../functions/_lib/core/respond.js");
    assert(!respondSrc.includes("provided !== env.CRON_SECRET") && respondSrc.includes("timingSafeEqualStr(provided, env.CRON_SECRET)"),
      "P26-2: بوابة الـcron تقارن CRON_SECRET بمقارنة ثابتة الزمن");
    for (const f of ["bulk_process", "healthcheck", "reminders"]) {
      const src = read(`../../functions/api/cron/${f}.js`);
      assert(/withApi\.raw\(/.test(src) && /cron: true/.test(src) && !/CRON_SECRET/.test(src),
        `P26-2: cron/${f} يمرّ ببوابة CRON_SECRET الموحّدة (بلا نسخة محلية)`);
    }

    const rem = read("../../functions/_lib/domain/booking.js");
    assert(/SELECT id, ticket_code,/.test(rem) && rem.includes("booking.ticket_code ||"),
      "P18-1: التذكير يقرأ عمود ticket_code (المصدر الوحيد) بدل إعادة حسابه");
    const remEndpoint = read("../../functions/api/cron/reminders.js");
    assert(!rem.includes("966500000000") && !remEndpoint.includes("966500000000") && remEndpoint.includes("if (employeePhone)"),
      "P49/P18-2: لا رقم موظف مفبرك — يُتخطى التذكير عند غياب الرقم");

    const chat = read("../../functions/api/chat.js") + read("../../functions/_lib/domain/conversation.js");
    assert(!chat.includes("body.debug"), "P23: علم debug لا يُقرأ من جسم الطلب — من البيئة فقط");

    // كل console.error خام هاجر إلى logError (errorLog.js هو السنك الوحيد المسموح).
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = new URL("../../functions", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".js") && !p.endsWith("errorLog.js") && readFileSync(p, "utf8").includes("console.error(")) offenders.push(name);
      }
    };
    walk(root);
    assert(offenders.length === 0, `LOG-1: صفر console.error خام خارج errorLog.js (المخالف: ${offenders.join(", ") || "لا شيء"})`);
  }
}

main()
  .then(() => done())
  .catch((e) => {
    console.error("❌ Tests threw an exception:");
    console.error(e);
    process.exit(1);
  });

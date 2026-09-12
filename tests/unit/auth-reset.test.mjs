// استعادة كلمة المرور برابط بالبريد (2026-09-13) — بدل رمز الـ٦ أرقام.
// بلا شبكة: fetch وD1 وKV كلها محاكاة محلية.
import { createRunner, createRlKv, createSessionVersionKv, TEST_SESSION_SECRET } from "../_helpers.mjs";

const { assert, done } = createRunner("auth-reset");

const USER = "user@aura.sa";

// D1 بالذاكرة يغطي عبارات المسار فقط؛ كل SQL يُسجَّل للفحص.
function makeDb({ accounts = { [USER]: "m_1" }, failOn = null } = {}) {
  const state = { resets: new Map(), passwordWrites: [], bumps: 0, loginCleared: 0, errors: [], sql: [] };
  const db = {
    prepare(query) {
      return {
        bind(...args) {
          state.sql.push({ query, args });
          const maybeFail = () => { if (failOn && query.includes(failOn)) throw new Error("d1 down"); };
          return {
            async first() {
              maybeFail();
              if (query.includes("SELECT merchant_id FROM accounts")) {
                const id = accounts[args[0]];
                return id ? { merchant_id: id } : null;
              }
              if (query.includes("DELETE FROM password_resets")) {
                for (const [email, row] of state.resets) {
                  if (row.tokenHash === args[0]) {
                    state.resets.delete(email);
                    return row.expiresAt > Date.now() ? { email } : null;
                  }
                }
                return null;
              }
              if (query.includes("SET session_version")) {
                state.bumps++;
                return { session_version: state.bumps };
              }
              return null;
            },
            async run() {
              maybeFail();
              if (query.includes("INSERT INTO password_resets")) {
                state.resets.set(args[0], { tokenHash: args[1], expiresAt: Date.now() + args[2] * 60_000 });
              } else if (query.includes("SET password_hash")) {
                state.passwordWrites.push(args[2]);
                return { meta: { changes: Object.values(accounts).includes(args[2]) ? 1 : 0 } };
              } else if (query.includes("DELETE FROM login_attempts")) {
                state.loginCleared++;
              } else if (query.includes("INSERT INTO error_log")) {
                state.errors.push(args[2]);
              }
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };
  return { db, state };
}

const CONFIGURED = { RESEND_API_KEY: "re_test_key", EMAIL_FROM: "هالة <no-reply@send.example.com>" };

function mkEnv(db, extra = {}) {
  return { DB: db, SESSION_SECRET: TEST_SESSION_SECRET, HALA_CACHE: createRlKv(), ...CONFIGURED, ...extra };
}

function post(path, body, ip = "1.1.1.1") {
  return new Request(`https://halah.aura.sa${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body)
  });
}

// fetch مزيَّف يلتقط طلبات Resend.
const sent = [];
let providerStatus = 200;
globalThis.fetch = async (url, init) => {
  sent.push({ url: String(url), init });
  if (providerStatus !== 200) return new Response('{"message":"boom"}', { status: providerStatus });
  return new Response(JSON.stringify({ id: "email_1" }), { status: 200, headers: { "content-type": "application/json" } });
};
const lastToken = () => {
  const body = JSON.parse(sent[sent.length - 1].init.body);
  return body.text.match(/#token=([A-Za-z0-9_-]+)/)[1];
};

async function main() {
  const { onRequestPost: forgot } = await import("../../functions/api/auth/forgot_password.js");
  const { onRequestPost: reset } = await import("../../functions/api/auth/reset_password.js");
  const pr = await import("../../functions/_lib/domain/passwordReset.js");

  // ── ١. التوكن والتجزئة ────────────────────────────────────────────────
  {
    const t1 = pr.generateResetToken();
    const t2 = pr.generateResetToken();
    assert(pr.isWellFormedResetToken(t1) && t1 !== t2, "PR-1: توكن ٤٣ حرف base64url (٢٥٦ بت) وفريد بكل طلب");
    const h = await pr.hashResetToken(t1);
    assert(/^[0-9a-f]{64}$/.test(h) && h === (await pr.hashResetToken(t1)) && !h.includes(t1), "PR-2: التجزئة SHA-256 hex حتمية ولا تحوي التوكن");
    assert(!pr.isWellFormedResetToken("") && !pr.isWellFormedResetToken("123456") && !pr.isWellFormedResetToken(t1 + "x"), "PR-3: رموز قديمة/فارغة/مشوّهة مرفوضة قبل أي استعلام");
    assert(pr.resetLink(t1) === `https://halah.aura.sa/reset-password#token=${t1}`, "PR-4: الرابط على أصل الإنتاج الثابت والتوكن بجزء # (لا يصل للخادم)");
    assert(pr.RESET_TTL_MINUTES === 30, "PR-5: الصلاحية ٣٠ دقيقة");
  }

  // ── ٢. الطلب: إرسال فعلي + شكل حمولة Resend + تخزين التجزئة فقط ───────
  {
    const { db, state } = makeDb();
    sent.length = 0;
    const res = await forgot({ request: post("/api/auth/forgot_password", { email: "User@Aura.sa" }), env: mkEnv(db) });
    const body = await res.json();
    assert(res.status === 200 && body.ok === true, "PR-6: طلب لبريد مسجّل يرد ٢٠٠");
    assert(sent.length === 1 && sent[0].url === "https://api.resend.com/emails", "PR-7: طلب واحد إلى https://api.resend.com/emails");
    const init = sent[0].init;
    const payload = JSON.parse(init.body);
    assert(init.method === "POST" && init.headers.Authorization === "Bearer re_test_key" && init.headers["content-type"] === "application/json", "PR-8: POST بـBearer من RESEND_API_KEY وJSON");
    assert(payload.from === CONFIGURED.EMAIL_FROM && Array.isArray(payload.to) && payload.to[0] === USER && /استعادة كلمة المرور/.test(payload.subject), "PR-9: from من EMAIL_FROM، to مصفوفة بالبريد المطبَّع، موضوع عربي");
    assert(/dir="rtl"/.test(payload.html) && /lang="ar"/.test(payload.html) && typeof payload.text === "string", "PR-10: HTML عربي RTL مع نسخة نصية");
    assert(!/[٠-٩]+\s*ريال|SAR|خصم|عرض/.test(payload.text), "PR-11: القالب بلا تسويق ولا أسعار");
    const token = lastToken();
    const row = state.resets.get(USER);
    assert(row && row.tokenHash === (await pr.hashResetToken(token)) && row.tokenHash !== token, "PR-12: D1 يحفظ تجزئة التوكن لا التوكن");
    assert(!state.sql.some((s) => s.args.includes(token)), "PR-13: التوكن الخام لا يمر بأي عبارة SQL");
    const insert = state.sql.find((s) => s.query.includes("INSERT INTO password_resets"));
    assert(insert.args[2] === 30 && /datetime\('now', '\+' \|\| \? \|\| ' minutes'\)/.test(insert.query), "PR-14: الانتهاء يُحسب بالخادم (now + 30 دقيقة)");
  }

  // ── ٣. لا تعداد حسابات ──────────────────────────────────────────────────
  {
    const a = makeDb();
    const b = makeDb();
    sent.length = 0;
    const r1 = await forgot({ request: post("/api/auth/forgot_password", { email: USER }, "2.2.2.1"), env: mkEnv(a.db) });
    const r2 = await forgot({ request: post("/api/auth/forgot_password", { email: "ghost@nowhere.sa" }, "2.2.2.2"), env: mkEnv(b.db) });
    const [b1, b2] = [await r1.text(), await r2.text()];
    assert(r1.status === r2.status && b1 === b2, "PR-15: الرد متطابق حرفياً لبريد مسجّل وغير مسجّل");
    assert(sent.length === 1 && b.state.resets.size === 0, "PR-16: بريد غير مسجّل لا يُرسل له ولا يُخزَّن له شيء");
    assert(/إن كان هذا البريد مسجّلاً/.test(JSON.parse(b1).message), "PR-17: الرسالة مشروطة — لا تدّعي إرسالاً مؤكداً");

    // الإرسال يجري بعد الرد عبر waitUntil فالزمن لا يكشف الحساب.
    const c = makeDb();
    const pending = [];
    const res = await forgot({ request: post("/api/auth/forgot_password", { email: USER }, "2.2.2.3"), env: mkEnv(c.db), waitUntil: (p) => pending.push(p) });
    assert(res.status === 200 && pending.length >= 1, "PR-18: العمل (بحث + إرسال) يُسلَّم لـwaitUntil");
    await Promise.all(pending);
  }

  // ── ٤. غياب السر = فشل مغلق صريح ───────────────────────────────────────
  {
    for (const missing of ["RESEND_API_KEY", "EMAIL_FROM"]) {
      const { db, state } = makeDb();
      sent.length = 0;
      const env = mkEnv(db, { [missing]: undefined });
      const res = await forgot({ request: post("/api/auth/forgot_password", { email: USER }, "3.3.3.3"), env });
      const body = await res.json();
      assert(res.status === 503 && body.ok === false && body.code === "EMAIL_NOT_CONFIGURED" && /غير مفعّلة/.test(body.error), `PR-19/${missing}: غيابه = 503 بعربية صادقة`);
      assert(sent.length === 0 && state.resets.size === 0, `PR-20/${missing}: لا إرسال ولا توكن مخزَّن`);
      assert(state.errors.includes("RESET_EMAIL_NOT_CONFIGURED"), `PR-21/${missing}: خطأ مسجَّل بكود RESET_EMAIL_NOT_CONFIGURED`);
    }
    // والمحوّل نفسه يرمي بلا مفتاح.
    const { send } = await import("../../functions/_lib/integrations/email.js");
    let threw = false;
    try { await send({ EMAIL_FROM: "x@y.z" }, { to: USER, subject: "s", text: "t" }); } catch { threw = true; }
    assert(threw, "PR-22: integrations/email.send يرمي بلا RESEND_API_KEY");
  }

  // ── ٥. فشل المزوّد: يُسجَّل بلا بريد/توكن، والرد لا يكشف الحساب ─────────
  {
    const { db, state } = makeDb();
    providerStatus = 500;
    const res = await forgot({ request: post("/api/auth/forgot_password", { email: USER }, "4.4.4.4"), env: mkEnv(db) });
    providerStatus = 200;
    assert(res.status === 200, "PR-23: فشل المزوّد لا يغيّر الرد (لا تعداد)");
    assert(state.errors.includes("RESET_EMAIL_SEND_FAILED"), "PR-24: فشل المزوّد مسجَّل بكود RESET_EMAIL_SEND_FAILED");
    const logRow = state.sql.find((s) => s.query.includes("INSERT INTO error_log") && s.args[2] === "RESET_EMAIL_SEND_FAILED");
    assert(!String(logRow.args[4]).includes(USER), "PR-25: السجل لا يحمل البريد");
  }

  // ── ٦. حد المعدل: لكل بريد ولكل IP ──────────────────────────────────────
  {
    const { db } = makeDb();
    const env = mkEnv(db);
    sent.length = 0;
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const r = await forgot({ request: post("/api/auth/forgot_password", { email: USER }, `5.5.5.${i}`), env });
      statuses.push(r.status);
    }
    assert(statuses.slice(0, 3).every((s) => s === 200) && statuses[3] === 429, "PR-26: ٣ روابط بالساعة لكل بريد ثم ٤٢٩ حتى من IP مختلف");
    assert(sent.length === 3, "PR-27: الطلب المحجوب لا يرسل بريداً");
    const ghost = [];
    for (let i = 0; i < 4; i++) ghost.push((await forgot({ request: post("/api/auth/forgot_password", { email: "ghost@nowhere.sa" }, `5.5.6.${i}`), env })).status);
    assert(ghost[3] === 429, "PR-28: الحد لكل بريد يُطبَّق على غير المسجّل أيضاً (لا تعداد عبر ٤٢٩)");
    const perIp = [];
    for (let i = 0; i < 6; i++) perIp.push((await forgot({ request: post("/api/auth/forgot_password", { email: `u${i}@x.sa` }, "6.6.6.6"), env })).status);
    assert(perIp[5] === 429, "PR-29: ٥ طلبات بالدقيقة لكل IP ثم ٤٢٩");
    const keys = [];
    const spyKv = { get: async () => null, put: async (k) => void keys.push(k) };
    await forgot({ request: post("/api/auth/forgot_password", { email: USER }, "7.7.7.7"), env: { ...env, HALA_CACHE: spyKv } });
    assert(keys.length > 0 && keys.every((k) => !k.includes(USER)), "PR-30: مفاتيح KV لا تحوي البريد نفسه");
    const noKv = await forgot({ request: post("/api/auth/forgot_password", { email: USER }, "7.7.7.8"), env: { ...env, HALA_CACHE: undefined } });
    assert(noKv.status === 429, "PR-31: بلا KV يفشل الحد مغلقاً");
  }

  // ── ٧. التعيين: استخدام واحد، انتهاء، إبطال الجلسات ────────────────────
  {
    const { db, state } = makeDb();
    const env = { ...mkEnv(db), HALA_CACHE: createSessionVersionKv() };
    sent.length = 0;
    await forgot({ request: post("/api/auth/forgot_password", { email: USER }, "8.8.8.1"), env: mkEnv(db) });
    const token = lastToken();

    const short = await reset({ request: post("/api/auth/reset_password", { token, newPassword: "short" }, "8.8.8.2"), env });
    assert(short.status === 400 && state.resets.has(USER), "PR-32: كلمة مرور قصيرة تُرفض قبل استهلاك الرابط");

    const ok = await reset({ request: post("/api/auth/reset_password", { token, newPassword: "brandNewPass1", email: "attacker@evil.sa" }, "8.8.8.3"), env });
    const okBody = await ok.json();
    assert(ok.status === 200 && okBody.ok === true, "PR-33: رابط صالح يعيّن كلمة المرور");
    assert(state.passwordWrites.length === 1 && state.passwordWrites[0] === "m_1", "PR-34: الكتابة على حساب صاحب صف D1 (merchant_id) — بريد يرسله العميل يُتجاهل");
    assert(state.bumps === 1, "PR-35: نسخة الجلسة تُرفع — كل الجلسات القديمة تموت");
    assert(state.loginCleared === 1, "PR-36: قفل تسجيل الدخول يُمسح بعد النجاح");
    assert(!state.resets.has(USER), "PR-37: الرابط محذوف بعد الاستخدام");

    const again = await reset({ request: post("/api/auth/reset_password", { token, newPassword: "anotherPass2" }, "8.8.8.4"), env });
    const againBody = await again.json();
    assert(again.status === 400 && againBody.code === "RESET_LINK_INVALID" && state.passwordWrites.length === 1, "PR-38: نفس الرابط مرة ثانية مرفوض (استخدام واحد)");

    const consume = state.sql.find((s) => s.query.includes("DELETE FROM password_resets"));
    assert(/RETURNING email/.test(consume.query) && /expires_at > datetime\('now'\)/.test(consume.query), "PR-39: الاستهلاك ذرّي (DELETE … RETURNING) ويشترط عدم الانتهاء");

    // طلب جديد يُبطل الرابط السابق.
    await forgot({ request: post("/api/auth/forgot_password", { email: USER }, "8.8.9.1"), env: mkEnv(db) });
    const first = lastToken();
    await forgot({ request: post("/api/auth/forgot_password", { email: USER }, "8.8.9.2"), env: mkEnv(db) });
    const second = lastToken();
    const stale = await reset({ request: post("/api/auth/reset_password", { token: first, newPassword: "brandNewPass1" }, "8.8.9.3"), env });
    assert(stale.status === 400 && first !== second, "PR-40: طلب رابط جديد يُبطل الرابط الأقدم");

    // منتهٍ.
    state.resets.get(USER).expiresAt = Date.now() - 1000;
    const expired = await reset({ request: post("/api/auth/reset_password", { token: second, newPassword: "brandNewPass1" }, "8.8.9.4"), env });
    assert(expired.status === 400 && state.passwordWrites.length === 1, "PR-41: رابط منتهي الصلاحية مرفوض ولا يكتب شيئاً");

    const bogus = await reset({ request: post("/api/auth/reset_password", { token: "123456", newPassword: "brandNewPass1" }, "8.8.9.5"), env });
    assert(bogus.status === 400 && !state.sql.some((s) => s.query.includes("DELETE FROM password_resets") && s.args[0] === "123456"), "PR-42: رمز ٦ أرقام قديم مرفوض بلا استعلام");
  }

  // ── ٨. عطل D1 عند الاستهلاك = فشل مغلق ─────────────────────────────────
  {
    const { db, state } = makeDb({ failOn: "DELETE FROM password_resets" });
    const res = await reset({ request: post("/api/auth/reset_password", { token: pr.generateResetToken(), newPassword: "brandNewPass1" }, "9.9.9.9"), env: mkEnv(db) });
    assert(res.status === 503 && state.passwordWrites.length === 0, "PR-43: عطل D1 أثناء الاستهلاك يرفض (503) ولا يكتب كلمة مرور");
  }
}

main()
  .then(() => done())
  .catch((e) => {
    console.error("❌ Tests threw an exception:");
    console.error(e);
    process.exit(1);
  });

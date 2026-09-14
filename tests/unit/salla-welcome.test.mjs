// حساب التاجر + بريد الترحيب عند تثبيت Easy Mode (متطلب اجتماع ما قبل الإطلاق مع سلة 2026-09-15).
import { readFileSync } from "node:fs";
import { createRunner, fakeKv } from "../_helpers.mjs";
import { ensureAccountAndWelcome, welcomeEmailContent } from "../../functions/_lib/domain/sallaWelcome.js";

const { assert, done } = createRunner("salla-welcome");

function fakeAccountsDb(seed = []) {
  const accounts = new Map(seed.map((a) => [a.merchant_id, a]));
  return {
    accounts,
    prepare(sql) {
      return {
        bind(...a) {
          return {
            first: async () => {
              if (/SELECT email FROM accounts WHERE merchant_id = \?/.test(sql)) return accounts.get(a[0]) ? { email: accounts.get(a[0]).email } : null;
              if (/SELECT merchant_id FROM accounts WHERE email = \?/.test(sql)) {
                const hit = [...accounts.values()].find((x) => x.email === a[0]);
                return hit ? { merchant_id: hit.merchant_id } : null;
              }
              return null;
            },
            run: async () => {
              if (/INSERT INTO accounts/.test(sql)) accounts.set(a[0], { merchant_id: a[0], email: a[1], password_hash: a[2], password_salt: a[3] });
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };
}

function withFetch(owner, run) {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("accounts.salla.sa/oauth2/user/info")) {
      if (init?.headers?.Authorization !== "Bearer tok_1") return new Response("{}", { status: 401 });
      return new Response(JSON.stringify({ data: owner }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url).includes("api.resend.com")) {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
    }
    throw new Error("unexpected fetch " + url);
  };
  return run(sent).finally(() => { globalThis.fetch = real; });
}

const OWNER = { email: "Owner@Store.SA", name: "سارة", merchant: { name: "متجر الورد" } };
const MAIL_ENV = { RESEND_API_KEY: "re_test", EMAIL_FROM: "هالة <no-reply@aura.sa>" };

async function main() {
  await withFetch(OWNER, async (sent) => {
    const env = { DB: fakeAccountsDb(), HALA_CACHE: fakeKv(), ...MAIL_ENV };
    const logs = [];
    const first = await ensureAccountAndWelcome(env, { merchantId: "m_new", accessToken: "tok_1", onLog: (c) => logs.push(c) });
    const acc = env.DB.accounts.get("m_new");
    assert(first.account === "created" && first.email === "sent" && acc?.email === "owner@store.sa" && acc.password_hash && acc.password_salt, `SW-1: التثبيت ينشئ حساب التاجر ببريد سلة ويرسل الترحيب (${JSON.stringify(first)})`);
    assert(sent.length === 1 && sent[0].to[0] === "owner@store.sa" && /حسابك جاهز/.test(sent[0].subject) && /تطبيقاتي/.test(sent[0].text) && /نسيت كلمة المرور/.test(sent[0].text), "SW-2: بريد الترحيب للتاجر نفسه ويشرح الدخول من سلة والموقع");
    const again = await ensureAccountAndWelcome(env, { merchantId: "m_new", accessToken: "tok_1", onLog: (c) => logs.push(c) });
    assert(again.account === "exists" && again.email === "already_sent" && sent.length === 1, "SW-3: تكرار الويبهوك أو إعادة التثبيت لا ينشئ حساباً ثانياً ولا يرسل بريداً ثانياً");
    assert(!logs.some((l) => /@/.test(l)), "SW-4: لا بريد في أكواد السجل");
  });

  await withFetch(OWNER, async (sent) => {
    const env = { DB: fakeAccountsDb([{ merchant_id: "m_site", email: "owner@store.sa" }]), HALA_CACHE: fakeKv(), ...MAIL_ENV };
    const r = await ensureAccountAndWelcome(env, { merchantId: "m_salla", accessToken: "tok_1" });
    assert(r.account === "email_taken" && !env.DB.accounts.has("m_salla") && sent.length === 1, "SW-5: بريد مسجّل بحساب آخر لا يُكرَّر بحساب ثانٍ، والترحيب يصل");
  });

  await withFetch(OWNER, async (sent) => {
    const env = { DB: fakeAccountsDb(), HALA_CACHE: fakeKv() };
    const logs = [];
    const r = await ensureAccountAndWelcome(env, { merchantId: "m_nomail", accessToken: "tok_1", onLog: (c) => logs.push(c) });
    assert(r.account === "created" && r.email === "not_configured" && sent.length === 0 && logs.includes("WELCOME_EMAIL_NOT_CONFIGURED"), "SW-6: بلا Resend الحساب يُنشأ، ولا ادعاء إرسال، والنقص مسجَّل");
  });

  await withFetch({ email: "", name: "x" }, async (sent) => {
    const env = { DB: fakeAccountsDb(), HALA_CACHE: fakeKv(), ...MAIL_ENV };
    const r = await ensureAccountAndWelcome(env, { merchantId: "m_x", accessToken: "tok_1" });
    assert(r.account === "skipped" && !env.DB.accounts.size && sent.length === 0, "SW-7: بلا بريد صالح من سلة لا حساب ولا بريد");
  });

  {
    const c = welcomeEmailContent({ name: "<script>", storeName: "متجر \"x\"", email: "a@b.sa" });
    assert(!/<script>/.test(c.html) && /&lt;script&gt;/.test(c.html) && /dir="rtl"/.test(c.html), "SW-8: اسم التاجر والمتجر مهرَّبان في HTML");
    const salla = readFileSync(new URL("../../functions/_lib/domain/salla.js", import.meta.url), "utf8");
    const auth = salla.slice(salla.indexOf('case "app.store.authorize"'), salla.indexOf('case "app.installed"'));
    assert(/await ensureAccountAndWelcome\(env, \{ merchantId, accessToken: data\.access_token, onLog \}\)/.test(auth) && /SALLA_WELCOME_FAILED/.test(auth) && auth.indexOf("saveTokens") < auth.indexOf("ensureAccountAndWelcome"), "SW-9: ويبهوك التثبيت يحفظ التوكنات ثم ينشئ الحساب ويرحّب، وفشله لا يُسقط التثبيت");
  }
}

main().then(done);

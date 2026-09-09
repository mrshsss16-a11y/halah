import { createRunner } from "../_helpers.mjs";
import { createRlKv } from "../_helpers.mjs";

const { assert, done } = createRunner("auth-google");

async function main() {
  const rlKv = createRlKv();
  {
    const { onRequestPost: googlePost } = await import("../../functions/api/auth/google.js");

    const GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";

    // A stand-in accounts table. `accounts` maps email → merchant_id, exactly
    // like the two real rows: an `m_` id was created by signup.js (password),
    // an `m_g_` id by google.js.
    function makeGoogleDb({ accounts = {}, failSelect = false }) {
      const state = { accounts: { ...accounts }, insertedAccounts: [], insertedMerchants: [] };
      const env = {
        SESSION_SECRET: "test-secret-12345",
        HALA_CACHE: rlKv,
        GOOGLE_CLIENT_ID,
        ADMIN_EMAILS: "admin@aura.sa",
        DB: {
          prepare(query) {
            return {
              // P59: trialSeatUsage() scans the table with .all() and no bind.
              async all() {
                if (failSelect) throw new Error("D1_ERROR: accounts unreachable");
                return { results: Object.keys(state.accounts).map((email) => ({ email })) };
              },
              bind(...args) {
                return {
                  async first() {
                    if (query.includes("FROM accounts")) {
                      if (failSelect) throw new Error("D1_ERROR: accounts unreachable");
                      const merchantId = state.accounts[args[0]];
                      return merchantId ? { merchant_id: merchantId } : null;
                    }
                    return null;
                  },
                  async run() {
                    if (query.includes("INTO accounts")) {
                      state.insertedAccounts.push({ merchantId: args[0], email: args[1] });
                      state.accounts[args[1]] = args[0];
                    } else if (query.includes("INTO merchants")) {
                      state.insertedMerchants.push(args[0]);
                    }
                    return { meta: { changes: 1, last_row_id: 1 } };
                  }
                };
              }
            };
          }
        }
      };
      return { env, state };
    }

    // Stub Google's tokeninfo endpoint: the credential string IS the subject,
    // so each test can mint a distinct Google identity.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const credential = decodeURIComponent(String(url).split("id_token=")[1] || "");
      const [sub, email] = credential.split("|");
      if (!sub || !email) return { ok: false, json: async () => ({}) };
      return {
        ok: true,
        json: async () => ({
          aud: GOOGLE_CLIENT_ID,
          sub,
          email,
          email_verified: "true",
          name: "تاجر تجريبي"
        })
      };
    };

    const googleReq = (credential) =>
      new Request("https://x/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential })
      });

    try {
      // (a) THE ATTACK: an attacker already registered the victim's address via
      //     signup (an `m_` row). Google sign-in must NOT join that account.
      const hijack = makeGoogleDb({ accounts: { "victim@aura.sa": "m_abcdef123456" } });
      const hijackRes = await googlePost({ request: googleReq("sub-victim|victim@aura.sa"), env: hijack.env });
      const hijackBody = await hijackRes.json();
      assert(hijackRes.status === 409, "P41: Google sign-in is refused when a password account holds the address");
      assert(
        hijackBody.code === "PASSWORD_ACCOUNT_EXISTS",
        "P41: the refusal carries PASSWORD_ACCOUNT_EXISTS, not a session"
      );
      assert(
        !hijackRes.headers.get("Set-Cookie"),
        "P41: no session cookie is issued for the refused password account"
      );
      assert(
        hijack.state.insertedAccounts.length === 0,
        "P41: the refusal creates no parallel account row either (no silent fork)"
      );
      assert(
        /كلمة المرور/.test(hijackBody.error),
        "P41: the Arabic message points the user at password login"
      );

      // (b) REGRESSION — the two real rows must both still sign in.
      //     shssk.16@gmail.com is an `m_g_` (Google-created) account: Google
      //     signs it back into the SAME merchant_id, no new row.
      const real = makeGoogleDb({
        accounts: { "shssk.16@gmail.com": "m_g_101234567890123", "info@aurateam3.com": "m_71cbd12e0f4a" }
      });
      const googleAcctRes = await googlePost({
        request: googleReq("101234567890123|shssk.16@gmail.com"),
        env: real.env
      });
      const googleAcctBody = await googleAcctRes.json();
      assert(googleAcctRes.status === 200, "P41 regression: the existing m_g_ Google account still signs in");
      assert(
        googleAcctBody.storeId === "m_g_101234567890123",
        "P41 regression: it lands on its existing merchant_id, not a new one"
      );
      assert(
        Boolean(googleAcctRes.headers.get("Set-Cookie")),
        "P41 regression: the Google account still gets its session cookie"
      );
      assert(real.state.insertedAccounts.length === 0, "P41 regression: no duplicate account row is created");

      //     info@aurateam3.com is an `m_` (password) account. Its login path is
      //     /api/auth/login with its password — unchanged by this commit — and
      //     Google is now refused for it, which is the whole point of P41.
      const passwordAcctRes = await googlePost({
        request: googleReq("sub-info|info@aurateam3.com"),
        env: real.env
      });
      assert(
        passwordAcctRes.status === 409,
        "P41: the m_ password account is refused via Google (it still logs in with its password)"
      );
      assert(
        real.state.accounts["info@aurateam3.com"] === "m_71cbd12e0f4a",
        "P41: the password account row is left completely untouched"
      );

      // (c) a brand-new Google user is still provisioned normally.
      const fresh = makeGoogleDb({});
      const freshRes = await googlePost({ request: googleReq("998877665544332|new@aura.sa"), env: fresh.env });
      const freshBody = await freshRes.json();
      assert(freshRes.status === 200, "P41: a first-time Google user is still signed in");
      assert(
        freshBody.storeId.startsWith("m_g_"),
        "P41: a new Google account is provisioned with the m_g_ provider prefix"
      );
      assert(fresh.state.insertedAccounts.length === 1, "P41: exactly one accounts row is created for a new user");
      assert(fresh.state.insertedMerchants.length === 1, "P41: its merchants row is created too");

      // (d) FAIL CLOSED — if the accounts lookup itself errors, refuse. The old
      //     code swallowed it with .catch(() => null) and provisioned a second
      //     account for an address that may already belong to someone.
      const broken = makeGoogleDb({ accounts: { "victim@aura.sa": "m_abcdef123456" }, failSelect: true });
      const brokenRes = await googlePost({ request: googleReq("sub-x|victim@aura.sa"), env: broken.env });
      assert(brokenRes.status === 503, "P41: an unreadable accounts table refuses the sign-in (fails closed)");
      assert(
        broken.state.insertedAccounts.length === 0,
        "P41: a failed lookup never provisions an account behind the existing one"
      );
      assert(!brokenRes.headers.get("Set-Cookie"), "P41: no session is issued when the lookup fails");

      // (e) an m_ id can never be mistaken for an m_g_ id: `m_` ids are
      //     `m_` + uuid hex, and `g` is not a hex digit.
      const { GOOGLE_MERCHANT_PREFIX } = await import("../../functions/_lib/domain/accounts.js");
      let hexIdsLookGoogle = false;
      for (let i = 0; i < 200; i++) {
        if (`m_${crypto.randomUUID().slice(0, 12)}`.startsWith(GOOGLE_MERCHANT_PREFIX)) hexIdsLookGoogle = true;
      }
      assert(!hexIdsLookGoogle, "P41: a signup-generated m_ merchant id can never collide with the m_g_ prefix");
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  {
    const { normalizeEmailForDedupe, trialSeatUsage } = await import("../../functions/_lib/domain/accounts.js");

    // (أ) التطبيع نفسه
    assert(normalizeEmailForDedupe("Me+1@Gmail.com") === "me@gmail.com", "P59: +tag يُحذف");
    assert(normalizeEmailForDedupe("m.e@gmail.com") === "me@gmail.com", "P59: نقاط جيميل تُحذف");
    assert(
      normalizeEmailForDedupe("m.e+x@googlemail.com") === "me@gmail.com",
      "P59: googlemail يُوحَّد مع gmail، والنقاط والوسم يُحذفان"
    );
    // القاعدة الحاسمة: النقاط تُحذف بجيميل **فقط**. تعميمها يدمج أشخاصاً مختلفين.
    assert(
      normalizeEmailForDedupe("a.b@aura.sa") === "a.b@aura.sa",
      "P59: النقاط تبقى حرفية بالنطاقات غير جيميل (Workspace/غيره يعاملها كأحرف حقيقية)"
    );
    assert(normalizeEmailForDedupe("a.b+t@aura.sa") === "a.b@aura.sa", "P59: +tag يُحذف بكل النطاقات");
    assert(normalizeEmailForDedupe("+only@gmail.com") === "+only@gmail.com", "P59: لا نُفرغ جزءاً محلياً كله وسم");
    assert(normalizeEmailForDedupe("") === "", "P59: التطبيع آمن مع مدخل فارغ");

    // (ب) عدّاد المقاعد: الأدمن لا يحتسب، والصيغة البديلة تُكشف كمكرّر
    const seatDb = (emails) => ({
      DB: { prepare: () => ({ all: async () => ({ results: emails.map((email) => ({ email })) }) }) }
    });
    const usage = await trialSeatUsage(
      seatDb(["admin@aura.sa", "me@gmail.com", "other@aura.sa"]),
      "M.E+9@gmail.com",
      ["admin@aura.sa"]
    );
    assert(usage.count === 2, `P59: حسابات الأدمن لا تحتسب من المقاعد (got ${usage.count})`);
    assert(usage.duplicate, "P59: صيغة بديلة لنفس صندوق جيميل تُكشف كمكرّر");
    const distinct = await trialSeatUsage(seatDb(["a.b@aura.sa"]), "ab@aura.sa", []);
    assert(!distinct.duplicate, "P59: عنوانان يختلفان بنقطة على نطاق غير جيميل ليسا نفس الشخص");

    // (ج) signup.js يرفض الصيغة البديلة بنفس رسالة «مسجّل مسبقاً»
    const { onRequestPost: signupPost } = await import("../../functions/api/auth/signup.js");
    let signupInserted = 0;
    const signupEnv = (emails) => ({
      SESSION_SECRET: "test-secret-12345",
      HALA_CACHE: rlKv,
      ADMIN_EMAILS: "admin@aura.sa",
      DB: {
        prepare: () => ({
          all: async () => ({ results: emails.map((email) => ({ email })) }),
          bind: () => ({ first: async () => null, run: async () => ({}) })
        }),
        batch: async () => {
          signupInserted += 1;
          return [];
        }
      }
    });
    const signupJson = (body) =>
      new Request("https://x/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

    const dupRes = await signupPost({
      request: signupJson({ email: "M.E+2@gmail.com", password: "longenoughpw" }),
      env: signupEnv(["me@gmail.com"])
    });
    assert(dupRes.status === 409, `P59: signup يرفض الصيغة البديلة لبريد مسجّل (got ${dupRes.status})`);
    assert(signupInserted === 0, "P59: لا إدراج يحدث عند رفض المكرّر");
    assert(
      (await dupRes.json()).error === "هذا البريد مسجّل مسبقاً — سجّل دخول بدل ذلك.",
      "P59: نفس رسالة «مسجّل مسبقاً» — لا تسريب أن السبب تطبيع"
    );

    // السقف نفسه ما زال يعمل على العدد الحقيقي
    const full = Array.from({ length: 20 }, (_, i) => `m${i}@aura.sa`);
    const fullRes = await signupPost({
      request: signupJson({ email: "new@aura.sa", password: "longenoughpw" }),
      env: signupEnv(full)
    });
    assert(fullRes.status === 403, `P59: السقف ما زال يُطبَّق عند ٢٠ حساباً (got ${fullRes.status})`);
    assert((await fullRes.json()).code === "TRIAL_FULL", "P59: السقف يرد بـTRIAL_FULL");

    // وأقل من السقف يمرّ فعلاً — الفحص مستهدف لا رفض شامل
    const okRes = await signupPost({
      request: signupJson({ email: "fresh@aura.sa", password: "longenoughpw" }),
      env: signupEnv(["me@gmail.com"])
    });
    assert(okRes.status === 200, `P59: تسجيل مشروع تحت السقف ينجح (got ${okRes.status})`);

    // (د) فشل مغلق: جدول حسابات غير مقروء = رفض، لا "صفر حسابات"
    const brokenRes = await signupPost({
      request: signupJson({ email: "x@aura.sa", password: "longenoughpw" }),
      env: {
        SESSION_SECRET: "test-secret-12345",
        // عدّاد مستقل: حد signup ٣/ساعة لكل IP، والحالات السابقة استهلكت
        // نصيب الـIP المشترك — الاختبار هنا يقيس فشل D1 لا حد المعدل.
        HALA_CACHE: (() => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async () => {} }; })(),
        ADMIN_EMAILS: "admin@aura.sa",
        DB: {
          prepare: () => ({
            all: async () => {
              throw new Error("D1_ERROR");
            }
          })
        }
      }
    });
    assert(brokenRes.status === 503, `P59: فشل قراءة الحسابات يرفض التسجيل (fail closed, got ${brokenRes.status})`);

    // (هـ) google.js — المسار الذي كان يلتف على السقف كلياً
    const { onRequestPost: googleCapPost } = await import("../../functions/api/auth/google.js");
    const realFetch2 = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const credential = decodeURIComponent(String(url).split("id_token=")[1] || "");
      const [sub, email] = credential.split("|");
      if (!sub || !email) return { ok: false, json: async () => ({}) };
      return {
        ok: true,
        json: async () => ({
          aud: "cap-client-id",
          sub,
          email,
          email_verified: "true",
          name: "تاجر"
        })
      };
    };
    try {
      const capState = { inserts: 0, accounts: Array.from({ length: 20 }, (_, i) => `m${i}@aura.sa`) };
      const capEnv = {
        SESSION_SECRET: "test-secret-12345",
        HALA_CACHE: rlKv,
        GOOGLE_CLIENT_ID: "cap-client-id",
        ADMIN_EMAILS: "admin@aura.sa",
        DB: {
          prepare: (query) => ({
            all: async () => ({ results: capState.accounts.map((email) => ({ email })) }),
            bind: () => ({
              first: async () => null,
              run: async () => {
                if (String(query).includes("INTO accounts")) capState.inserts += 1;
                return {};
              }
            })
          })
        }
      };
      const gReq = (credential) =>
        new Request("https://x/api/auth/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential })
        });

      const gFull = await googleCapPost({ request: gReq("sub-new|newbie@aura.sa"), env: capEnv });
      const gFullBody = await gFull.json();
      assert(gFull.status === 403, `P59: google.js يخضع لسقف التجربة عند إنشاء حساب (got ${gFull.status})`);
      assert(gFullBody.code === "TRIAL_FULL", "P59: رفض جوجل عند الامتلاء يحمل TRIAL_FULL");
      assert(capState.inserts === 0, "P59: لا حساب يُنشأ بجوجل بعد امتلاء المقاعد");

      // وتحت السقف ما زال ينشئ الحساب — لم نكسر تسجيل الدخول بجوجل
      capState.accounts = ["one@aura.sa"];
      const gOk = await googleCapPost({ request: gReq("sub-ok|ok@aura.sa"), env: capEnv });
      assert(gOk.status === 200, `P59: تسجيل جوجل جديد تحت السقف ما زال ينجح (got ${gOk.status})`);
      assert(capState.inserts === 1, "P59: تسجيل جوجل تحت السقف ينشئ حساباً واحداً");
    } finally {
      globalThis.fetch = realFetch2;
    }
  }
}

main()
  .then(() => done())
  .catch((e) => {
    console.error("❌ Tests threw an exception:");
    console.error(e);
    process.exit(1);
  });

// اختبارات المرحلة ٦ (docs/ARCHITECTURE.md §٣، الصف الأخير — الأعلى مخاطرة).
//
// ما تثبّته هذه الاختبارات، بالترتيب:
//   ١. الـshims **زالت فعلاً**: لا `core/db.js` ولا مجلد `services/`.
//   ٢. `integrations/salla.js` HTTP خالص: لا D1، لا domain، والتوكن يُمرَّر إليه.
//   ٣. `refreshExpiringIgTokens` يجدّد توكناً قارب الانتهاء **ولا يلمس البعيد**
//      حين لا يوجد صف مستحق (محاكاة D1 + fetch).
//   ٤. `send()` بمحوّل إنستغرام يمرّ بالدوال الموصولة الثلاث (لا كود مكرَّر).
//   ٥. كل حارس `audit-*` بقائمة سماح صفرية — تُقرأ `EXPECTED_ALLOWLIST` من
//      نص السكربت نفسه، فلا يمرّ رقم مرفوع بصمت.
//
// الأسلوب: سلوكي حيث أمكن (تشغيل الدالة على D1/fetch وهميين والتحقق من الأثر)،
// وبنيوي فقط حيث يكون الادّعاء بنيوياً أصلاً (وجود ملف، اتجاه استيراد، رقم حارس).
import { existsSync, readFileSync } from "node:fs";
import { createRunner, TEST_ENCRYPTION_KEY } from "../_helpers.mjs";

const { assert, done } = createRunner("phase6");
const root = new URL("../../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");
const has = (rel) => existsSync(new URL(rel, root));

async function main() {
  // ── ١. الـshims زالت ───────────────────────────────────────────────────────
  assert(!has("functions/_lib/core/db.js"), "P6-1: ملف shim `core/db.js` محذوف");
  assert(!has("functions/_lib/services"), "P6-2: مجلد `services/` محذوف بالكامل");
  assert(
    has("functions/_lib/domain/catalog.js") &&
      has("functions/_lib/domain/review.js") &&
      has("functions/_lib/domain/publish.js") &&
      has("functions/_lib/domain/storeProfile.js") &&
      has("functions/_lib/domain/sallaProductPayload.js"),
    "P6-3: محتوى services/* الخمسة موجود بـdomain/* (نُقل لا حُذف)"
  );
  assert(
    has("functions/_lib/core/identity.js") &&
      /SELECT \* FROM merchants WHERE id = \?/.test(read("functions/_lib/core/identity.js")) &&
      !/getMerchant\b/.test(read("functions/_lib/domain/accounts.js").split("\n").filter((l) => !l.startsWith("//")).join("\n")),
    "P6-4: قراءتا الهوية بـcore/identity.js بنسخة واحدة — لا تكرار بـdomain/accounts.js"
  );

  // لا أثر نصي متبقٍّ لمسار الـshim بأي استيراد فعلي.
  {
    const files = [
      "functions/_lib/core/session.js",
      "functions/api/store/status.js",
      "functions/api/store/catalog/list.js",
      "functions/api/store/publish.js"
    ];
    const bad = files.filter((f) => /from\s*["'][^"']*(core\/db\.js|_lib\/services\/)/.test(read(f)));
    assert(bad.length === 0, `P6-5: صفر استيراد متبقٍّ من الـshims (${bad.join("، ") || "لا شيء"})`);
  }

  // ── ٢. integrations/salla.js محوّل HTTP خالص ──────────────────────────────
  {
    const src = read("functions/_lib/integrations/salla.js");
    const importLines = [...src.matchAll(/(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]);
    assert(importLines.length === 0, `P6-6: المحوّل بلا أي استيراد داخلي (وجد: ${importLines.join("، ") || "لا شيء"})`);
    // التعليقات تشرح التاريخ («التوكن يُجلَب بـdomain/salla.js») — الحكم على الكود.
    const code = src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert(!/domain\//.test(code), "P6-7: المحوّل لا يذكر domain/ بأي كود");
    assert(!/getValidSallaToken/.test(code), "P6-8: كتلة الـshim (getValidSallaToken) محذوفة");
    assert(!/\.prepare\(/.test(src) && !/env\.DB/.test(src), "P6-9: صفر D1 بالمحوّل");
    for (const fn of ["listProducts", "updateProduct", "updateProductBySku", "getStoreInfo"]) {
      assert(
        new RegExp(`export async function ${fn}\\(token`).test(src),
        `P6-10 (${fn}): التوقيع يبدأ بتوكن جاهز — المحوّل لا يجلبه`
      );
    }
  }

  // المستهلكون يمرّرون التوكن فعلاً.
  {
    const pairs = [
      ["functions/_lib/domain/catalog.js", /listProducts\(await getValidSallaToken\(env, merchantId\), page\)/],
      ["functions/_lib/domain/publish.js", /updateProductBySku\(await getValidSallaToken\(env, merchantId\), sku,/],
      ["functions/_lib/domain/storeOverview.js", /listProducts\(await getValidSallaToken\(env, merchant\.id\)\)/],
      ["functions/_lib/domain/salla.js", /getStoreInfo\(await getValidSallaToken\(env, merchantId\)\)/]
    ];
    for (const [file, re] of pairs) {
      assert(re.test(read(file)), `P6-11: ${file} يجلب التوكن ويمرّره للمحوّل`);
    }
  }

  // ── ٣. تجديد توكنات إنستغرام ─────────────────────────────────────────────
  {
    const { refreshExpiringIgTokens } = await import("../../functions/_lib/domain/instagram.js");
    const realFetch = globalThis.fetch;
    const nowS = Math.floor(Date.now() / 1000);

    /**
     * D1 وهمي: SELECT يرجّع الصفوف التي تحقق شرط `token_expires_at < ?`.
     * `ENCRYPTION_KEY` مضاف بعد تشفير توكنات القنوات بالراحة: التجديد صار
     * يفكّ التوكن القديم ويشفّر الجديد، وبلا مفتاح يرمي (fail closed).
     */
    const mkDb = (rows, log) => ({
      ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      DB: {
        prepare(sql) {
          return {
            bind(...args) {
              log.push({ sql, args });
              return {
                all: async () => ({ results: rows.filter((r) => r.token_expires_at < args[0]) }),
                run: async () => ({}),
                first: async () => null
              };
            }
          };
        }
      }
    });

    // (أ) توكن قارب الانتهاء (يومان) ⇒ نداء تجديد واحد + كتابة التوكن الجديد.
    {
      const log = [];
      const calls = [];
      globalThis.fetch = async (url) => {
        calls.push(String(url));
        return { ok: true, json: async () => ({ access_token: "NEW_TOKEN", expires_in: 5184000 }) };
      };
      let out;
      try {
        out = await refreshExpiringIgTokens(
          mkDb([{ merchant_id: "m_a", ig_user_id: "IG_A", access_token: "OLD", token_expires_at: nowS + 2 * 86400 }], log),
          null
        );
      } finally {
        globalThis.fetch = realFetch;
      }
      assert(out.checked === 1 && out.refreshed === 1 && out.failed === 0, "P6-12: توكن يتبقى له يومان يُجدَّد");
      assert(calls.length === 1 && /refresh_access_token/.test(calls[0]) && /ig_refresh_token/.test(calls[0]), "P6-13: نداء واحد على refresh_access_token بـgrant_type=ig_refresh_token");
      assert(!calls[0].includes("NEW_TOKEN") && calls[0].includes("OLD"), "P6-14: التجديد يُرسَل بالتوكن القديم (لا خلط)");
      const write = log.find((e) => /UPDATE ig_connections/.test(e.sql));
      // المعنى الأصلي محفوظ (التوكن الجديد يُكتب مقيَّداً بالتاجر والحساب)،
      // لكن القيمة صارت مشفَّرة بالراحة — فيُتحقَّق منها بفكّها لا بمساواتها.
      const { decryptSecret } = await import("../../functions/_lib/core/crypto.js");
      assert(
        write &&
          String(write.args[0]).startsWith("enc:v1:") &&
          (await decryptSecret({ ENCRYPTION_KEY: TEST_ENCRYPTION_KEY }, write.args[0])) === "NEW_TOKEN" &&
          write.args[2] === "m_a" &&
          write.args[3] === "IG_A",
        "P6-15: التوكن الجديد يُكتب مشفَّراً ومقيَّداً بـmerchant_id + ig_user_id (عزل المستأجرين)"
      );
      assert(write && Number(write.args[1]) > nowS + 50 * 86400, "P6-16: انتهاء الصلاحية الجديد يُحسب من expires_in المعاد");
    }

    // (ب) توكن بعيد الانتهاء (٤٠ يوماً) ⇒ **صفر نداء شبكة**.
    {
      const log = [];
      let touched = 0;
      globalThis.fetch = async () => { touched++; throw new Error("must not be called"); };
      let out;
      try {
        out = await refreshExpiringIgTokens(
          mkDb([{ merchant_id: "m_b", ig_user_id: "IG_B", access_token: "FAR", token_expires_at: nowS + 40 * 86400 }], log),
          null
        );
      } finally {
        globalThis.fetch = realFetch;
      }
      assert(touched === 0, "P6-17: توكن بعيد الانتهاء لا يلمس البعيد إطلاقاً");
      assert(out.checked === 0 && out.refreshed === 0, "P6-18: ولا يُحتسب ولا يُكتب");
      assert(!log.some((e) => /UPDATE ig_connections/.test(e.sql)), "P6-19: صفر كتابة D1 حين لا صف مستحق");
    }

    // (ج) فشل صف واحد لا يوقف البقية ولا يرمي.
    {
      const log = [];
      let n = 0;
      globalThis.fetch = async () => {
        n++;
        if (n === 1) return { ok: false, status: 400, json: async () => ({ error: "x" }) };
        return { ok: true, json: async () => ({ access_token: "T2", expires_in: 5184000 }) };
      };
      let out;
      try {
        out = await refreshExpiringIgTokens(
          mkDb([
            { merchant_id: "m_c", ig_user_id: "IG_C", access_token: "A", token_expires_at: nowS + 3600 },
            { merchant_id: "m_d", ig_user_id: "IG_D", access_token: "B", token_expires_at: nowS + 3600 }
          ], log),
          null
        );
      } finally {
        globalThis.fetch = realFetch;
      }
      assert(out.failed === 1 && out.refreshed === 1, "P6-20: فشل صف واحد يُحتسب ولا يمنع تجديد الباقي");
    }

    // (د) موصول فعلاً بتِك الـcron.
    {
      const hc = read("functions/api/cron/healthcheck.js");
      assert(
        /refreshExpiringIgTokens\(env, context\)/.test(hc) &&
          /from "\.\.\/\.\.\/_lib\/domain\/instagram\.js"/.test(hc),
        "P6-21: التجديد موصول بـapi/cron/healthcheck.js (لا كود ميت)"
      );
    }
  }

  // ── ٤. مسار إرسال إنستغرام: send() يمرّ بالدوال الموصولة ──────────────────
  {
    const igSrc = read("functions/_lib/integrations/instagram.js");
    assert(
      !/export async function (replyToComment|sendPrivateReply|sendDirectMessage|subscribeToWebhooks)\b/.test(igSrc),
      "P6-22: لا تصديرات إرسال بلا مستورد — `send` هي الواجهة الوحيدة"
    );
    assert(!/subscribeToWebhooks/.test(igSrc.replace(/^\/\/.*$/gm, "")), "P6-23: subscribeToWebhooks حُذفت (الاشتراك يدوي بلوحة Meta)");
    assert(/LEGACY|يدوي/.test(igSrc) || /لوحة Meta/.test(igSrc), "P6-24: الاشتراك اليدوي موثَّق بالملف بدل دالة موهمة");

    const ig = await import("../../functions/_lib/integrations/instagram.js");
    const conn = { ig_user_id: "IG_X", access_token: "TOK" };
    const realFetch = globalThis.fetch;
    const seen = [];
    globalThis.fetch = async (url, opts) => {
      seen.push({ url: String(url), body: JSON.parse(opts.body) });
      return { ok: true, json: async () => ({ id: "1" }) };
    };
    try {
      await ig.send({}, { conn, mode: "comment_reply", commentId: "C1" }, { text: "رد" });
      await ig.send({}, { conn, mode: "private_reply", commentId: "C1" }, { text: "رد" });
      await ig.send({}, { conn, mode: "dm", recipientId: "IGSID" }, { text: "رد" });
    } finally {
      globalThis.fetch = realFetch;
    }
    assert(seen.length === 3, "P6-25: الأوضاع الثلاثة كلها تُنفَّذ عبر send");
    assert(/\/C1\/replies$/.test(seen[0].url) && seen[0].body.message === "رد", "P6-26: comment_reply ⇒ replyToComment (POST /<id>/replies)");
    assert(/\/IG_X\/messages$/.test(seen[1].url) && seen[1].body.recipient.comment_id === "C1", "P6-27: private_reply ⇒ sendPrivateReply (recipient.comment_id)");
    assert(/\/IG_X\/messages$/.test(seen[2].url) && seen[2].body.recipient.id === "IGSID", "P6-28: dm ⇒ sendDirectMessage (recipient.id)");

    let threw = false;
    try { await ig.send({}, { conn, mode: "nope" }, { text: "x" }); } catch { threw = true; }
    assert(threw, "P6-29: وضع غير معروف يرمي — لا إرسال صامت لوجهة خاطئة");
  }

  // ── ٥. كل الحراس بقوائم سماح صفرية ───────────────────────────────────────
  {
    const guards = [
      ["scripts/audit-layering.mjs", /const EXPECTED_ALLOWLIST = (\d+);/],
      ["scripts/audit-file-size.mjs", /const EXPECTED_ALLOWLIST = (\d+);/],
      ["scripts/audit-dead-exports.mjs", /const EXPECTED_ALLOWLIST = (\d+);/]
    ];
    for (const [file, re] of guards) {
      const m = read(file).match(re);
      assert(m && Number(m[1]) === 0, `P6-30: ${file} — EXPECTED_ALLOWLIST = ${m ? m[1] : "غير موجود"} (المطلوب صفر)`);
    }

    // audit-migrations: الاستثناء الوحيد الباقي = جداول legacy، ومصدرها **واحد**
    // (AGENT.md §٦) لا نسخة بالسكربت — قرار مالك موثَّق بـdocs/DEFERRED.md.
    const mig = read("scripts/audit-migrations.mjs");
    assert(/LEGACY_TABLES:START/.test(mig) && /AGENT\.md/.test(mig), "P6-31: audit-migrations يقرأ جداول legacy من AGENT.md §٦");
    assert(
      !/\["users",/.test(mig) && !/\["pending_retargeting",/.test(mig),
      "P6-32: لا نسخة ثانية من القائمة داخل السكربت (مصدر واحد)"
    );
    const agent = read("AGENT.md");
    const block = agent.match(/LEGACY_TABLES:START[\s\S]*?LEGACY_TABLES:END/);
    const names = block ? [...block[0].matchAll(/^\s*-\s*`([a-z_][a-z0-9_]*)`/gim)].map((m) => m[1]) : [];
    assert(names.length === 8, `P6-33: كتلة AGENT.md تحمل ٨ جداول (وجد ${names.length})`);
    const migExpect = mig.match(/const EXPECTED_UNUSED_TABLES = (\d+);/);
    assert(migExpect && Number(migExpect[1]) === names.length, "P6-34: EXPECTED_UNUSED_TABLES مطابق لعدد أسطر الكتلة");
    assert(/DEFERRED/.test(mig) && /LEGACY_TABLES/.test(read("docs/DEFERRED.md")), "P6-35: قرار الحذف مؤجَّل وموثَّق بـdocs/DEFERRED.md");
  }

  // ── ٦. ق٦ مفروضة فعلاً ────────────────────────────────────────────────────
  {
    const layer = read("scripts/audit-layering.mjs");
    assert(/ق٦/.test(layer) && /functions\/_lib\/integrations\//.test(layer), "P6-36: ق٦ مضافة لحارس الطبقات");
    const offenders = [
      "functions/api/auth/forgot_password.js",
      "functions/api/auth/send_verification.js",
      "functions/api/cron/healthcheck.js",
      "functions/api/cron/reminders.js",
      "functions/api/instagram/webhook.js",
      "functions/api/whatsapp/send.js",
      "functions/api/whatsapp/webhook.js",
      "functions/api/store/publish.js"
    ].filter((f) => /from\s*["'][^"']*_lib\/integrations\//.test(read(f)));
    assert(offenders.length === 0, `P6-37: صفر نقطة api تستورد محوّلاً مباشرة (${offenders.join("، ") || "لا شيء"})`);
  }

  done();
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});

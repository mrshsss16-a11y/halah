// tests/unit/log-hygiene.test.mjs — بنود ٣.١ (مقارنة hub.verify_token ثابتة
// الزمن)، ٣.١٠ (تنقية أسرار السجلات)، و٣.٣ (تقليم error_log/webhook_log/
// ig_processed_events) من تقييم 2026-09-11.
import { createRunner, readSrc } from "../_helpers.mjs";

const { assert, done } = createRunner("log-hygiene");

async function main() {
  // ── ٣.١: hub.verify_token بمقارنة ثابتة الزمن (نمط Q1 الموحّد) ───────────
  {
    const waSrc = await readSrc(new URL("../../functions/api/whatsapp/webhook.js", import.meta.url));
    assert(!/token === context\.env\.WHATSAPP_VERIFY_TOKEN/.test(waSrc), "WA-1: مقارنة === المباشرة أُزيلت");
    assert(
      /timingSafeEqualStr\(token, expected\)/.test(waSrc) &&
        /from "\.\.\/\.\.\/_lib\/core\/crypto\.js"/.test(waSrc),
      "WA-2: يستخدم timingSafeEqualStr من core/crypto.js"
    );

    const igSrc = await readSrc(new URL("../../functions/api/instagram/webhook.js", import.meta.url));
    assert(!/token !== expected/.test(igSrc), "IG-1: مقارنة !== المباشرة أُزيلت");
    assert(
      /timingSafeEqualStr\(token, expected\)/.test(igSrc) &&
        /from "\.\.\/\.\.\/_lib\/core\/crypto\.js"/.test(igSrc),
      "IG-2: يستخدم timingSafeEqualStr من core/crypto.js"
    );

    // سلوكياً: الرمز الصحيح يمر، الخاطئ وطول مختلف وغياب السر كلها تُرفض.
    const wa = await import("../../functions/api/whatsapp/webhook.js");
    const ig = await import("../../functions/api/instagram/webhook.js");
    const getReq = (params) => new Request(`https://x/api?${new URLSearchParams(params)}`);

    const waRes1 = await wa.onRequestGet({
      request: getReq({ "hub.mode": "subscribe", "hub.verify_token": "s3cr3t", "hub.challenge": "c1" }),
      env: { WHATSAPP_VERIFY_TOKEN: "s3cr3t" }
    });
    assert(waRes1.status === 200 && (await waRes1.text()) === "c1", "WA-3: رمز صحيح ⇒ ٢٠٠ + challenge");

    const waRes2 = await wa.onRequestGet({
      request: getReq({ "hub.mode": "subscribe", "hub.verify_token": "s3cr3tX", "hub.challenge": "c1" }),
      env: { WHATSAPP_VERIFY_TOKEN: "s3cr3t" }
    });
    assert(waRes2.status === 403, "WA-4: رمز بطول مختلف يُرفض");

    const waRes3 = await wa.onRequestGet({
      request: getReq({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "c1" }),
      env: {}
    });
    assert(waRes3.status === 403, "WA-5: غياب WHATSAPP_VERIFY_TOKEN = رفض (fail-closed)، لا تطابق فارغ=فارغ");

    const igRes1 = await ig.onRequestGet({
      request: getReq({ "hub.mode": "subscribe", "hub.verify_token": "ig-secret", "hub.challenge": "c2" }),
      env: { INSTAGRAM_VERIFY_TOKEN: "ig-secret" }
    });
    assert(igRes1.status === 200 && (await igRes1.text()) === "c2", "IG-3: رمز صحيح ⇒ ٢٠٠ + challenge");

    const igRes2 = await ig.onRequestGet({
      request: getReq({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "c2" }),
      env: { INSTAGRAM_VERIFY_TOKEN: "ig-secret" }
    });
    assert(igRes2.status === 403, "IG-4: رمز خاطئ يُرفض");

    const igRes3 = await ig.onRequestGet({
      request: getReq({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "c2" }),
      env: {}
    });
    assert(igRes3.status === 403, "IG-5: غياب INSTAGRAM_VERIFY_TOKEN = رفض (fail-closed)");
  }

  // ── ٣.١٠: sanitizeInternal بـerrorLog.js ──────────────────────────────────
  {
    const { sanitizeInternal, logError } = await import("../../functions/_lib/core/errorLog.js");

    assert(sanitizeInternal(null) === null, "SAN-1: null يمر كما هو");

    const bearer = sanitizeInternal("failed calling API: Authorization: Bearer abc123.def456-XYZ");
    assert(!/abc123/.test(bearer) && /Bearer \[redacted\]/.test(bearer), "SAN-2: توكن Bearer يُستبدل");

    const meta = sanitizeInternal("Graph error for token EAABwzZCp0GZCZBqZBZBRandomLongTokenTextHere123456");
    assert(!/EAABwzZCp0GZC/.test(meta) && /\[redacted\]/.test(meta), "SAN-3: توكن ميتا EAA… يُستبدل");

    const qs = sanitizeInternal("GET /oauth?access_token=aVeryLongOpaqueTokenValue1234567890ABCDEFGH&x=1");
    assert(!/aVeryLongOpaqueTokenValue/.test(qs) && /access_token=\[redacted\]/.test(qs), "SAN-4: access_token= بالاستعلام يُستبدل");

    const secretEq = sanitizeInternal("secret=thisIsThirtyTwoCharsOrMoreOfSecretValue123");
    assert(/secret=\[redacted\]/.test(secretEq), "SAN-5: secret= الطويل يُستبدل");

    // سلسلة قصيرة (<٣٢) لا تُلمس — ليست "تشبه توكناً" بالتعريف المطلوب.
    const shortTok = sanitizeInternal("token=short123");
    assert(shortTok === "token=short123", "SAN-6: سلسلة أقصر من ٣٢ حرفاً بعد token= لا تُستبدل");

    const stack = "Error: boom\n  at f (a.js:1)\n  at g (b.js:2)\n  at h (c.js:3)\n  at i (d.js:4)\n  at j (e.js:5)";
    const trimmed = sanitizeInternal(stack);
    assert(trimmed.split("\n").length === 3, "SAN-7: stack يُقصّ لأول ٣ أسطر");
    assert(trimmed.startsWith("Error: boom\n  at f"), "SAN-8: الأسطر الثلاثة الأولى محفوظة كما هي");

    // logError يستخدم sanitizeInternal فعلياً قبل الكتابة — نلتقط ما يُكتب D1.
    const writes = [];
    const db = { prepare: () => ({ bind: (...args) => ({ run: async () => { writes.push(args); return {}; } }) }) };
    logError({ env: { DB: db } }, {
      requestId: "r1",
      path: "x",
      code: "C",
      internal: "leaked Bearer abcDEF123LongEnoughToken4567890 in stack"
    });
    await new Promise((r) => setTimeout(r, 0));
    const writtenInternal = writes[0]?.[4];
    assert(writtenInternal && !/abcDEF123LongEnoughToken/.test(writtenInternal), "SAN-9: القيمة المكتوبة على D1 منقّاة فعلاً، لا الخام");

    const respondSrc = await readSrc(new URL("../../functions/_lib/core/respond.js", import.meta.url));
    assert(/internal: String\(\(err && err\.stack\)/.test(respondSrc), "SAN-10: respond.js ما زال يمرر err.stack — التنقية مركزية بـerrorLog.js لا مكررة هنا");
  }

  // ── ٣.٣: تقليم دوري محدود الدفعة ──────────────────────────────────────────
  {
    const { pruneOldLogs } = await import("../../functions/_lib/domain/retention.js");

    const noDb = await pruneOldLogs({});
    assert(noDb.ran === false, "PRUNE-1: بلا DB لا يحاول شيئاً");

    const calls = [];
    const dbOk = {
      prepare(sql) {
        calls.push(sql);
        return { run: async () => ({ meta: { changes: 3 } }) };
      }
    };
    const res = await pruneOldLogs({ DB: dbOk });
    assert(res.ran === true, "PRUNE-2: يعمل مع DB متاح");
    assert(res.error_log === 3 && res.webhook_log === 3 && res.ig_processed_events === 3, "PRUNE-3: يرجّع عدد المحذوف بكل جدول");

    const joined = calls.join("\n");
    assert(/DELETE FROM error_log/.test(joined) && /created_at < datetime\('now', '-90 days'\)/.test(joined), "PRUNE-4: error_log أقدم من ٩٠ يوماً");
    assert(/DELETE FROM webhook_log/.test(joined) && /received_at < datetime\('now', '-90 days'\)/.test(joined), "PRUNE-5: webhook_log أقدم من ٩٠ يوماً");
    assert(/DELETE FROM ig_processed_events/.test(joined) && /created_at < datetime\('now', '-48 hours'\)/.test(joined), "PRUNE-6: ig_processed_events أقدم من ٤٨ ساعة");
    for (const sql of calls) {
      assert(/LIMIT 500/.test(sql), "PRUNE-7: كل استعلام حذف محدود بدفعة (LIMIT)");
    }

    // فشل جدول واحد لا يوقف البقية (fail-soft لكل جدول على حدة).
    let n = 0;
    const dbPartialFail = {
      prepare() {
        n++;
        const shouldFail = n === 2; // ثاني جدول (webhook_log بترتيب TARGETS)
        return { run: async () => { if (shouldFail) throw new Error("D1 down"); return { meta: { changes: 1 } }; } };
      }
    };
    const resPartial = await pruneOldLogs({ DB: dbPartialFail }, null);
    assert(resPartial.error_log === 1 && resPartial.ig_processed_events === 1, "PRUNE-8: نجاح جدولين رغم فشل الثالث");
    assert(resPartial.webhook_log === null && resPartial.failed.includes("webhook_log"), "PRUNE-9: الجدول الفاشل يُعلَّم لا يُبتلع صامتاً");

    // مُنادى فعلاً من healthcheck.js (تنسيق فقط، الحارس ٨٠ سطراً محفوظ).
    const hcSrc = await readSrc(new URL("../../functions/api/cron/healthcheck.js", import.meta.url));
    assert(/pruneOldLogs\(env, context\)/.test(hcSrc), "PRUNE-10: healthcheck.js ينادي pruneOldLogs");
    assert(hcSrc.split("\n").length <= 80, "PRUNE-11: healthcheck.js ما زال ≤٨٠ سطراً");

    // تعليق merchantPurge.js يشير للمكان الفعلي بدل «دورة حياة» غامضة.
    const purgeSrc = await readSrc(new URL("../../functions/_lib/domain/merchantPurge.js", import.meta.url));
    assert(/domain\/retention\.js/.test(purgeSrc), "PRUNE-12: التعليق يشير لـdomain/retention.js");
  }

  done();
}

main().catch((e) => {
  console.error("❌ log-hygiene tests threw an exception:");
  console.error(e);
  process.exit(1);
});

import { createRunner } from "../_helpers.mjs";

const { assert, done } = createRunner("instagram");

async function main() {
  // ── إنستغرام (docs/INSTAGRAM_PLAN.md المرحلة ٥) ────────────────────────
  {
    const ig = await import("../../functions/_lib/integrations/instagram.js");

    // T2 — التوقيع: fail closed بلا سر، ورفض التوقيع الخاطئ، وقبول الصحيح.
    const body = JSON.stringify({ object: "instagram", entry: [] });
    const secret = "ig-app-secret-test";
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const validSig =
      "sha256=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");

    assert(
      (await ig.verifyIgSignature(body, validSig, secret)) === true,
      "IG-T2: توقيع صحيح يُقبل"
    );
    assert(
      (await ig.verifyIgSignature(body, validSig, "")) === false,
      "IG-T2: fail closed — بلا App Secret يُرفض كل شيء (S1)"
    );
    assert(
      (await ig.verifyIgSignature(body, "sha256=deadbeef", secret)) === false,
      "IG-T2: توقيع خاطئ يُرفض"
    );
    assert(
      (await ig.verifyIgSignature(body, null, secret)) === false,
      "IG-T2: غياب ترويسة التوقيع يُرفض"
    );

    // T5 — الشكلان: Instagram Login (value مباشرة) وFacebook Login (changes[]).
    const direct = ig.parseIgComments({
      entry: [
        {
          id: "IG_ACCOUNT_1",
          field: "comments",
          value: { id: "C1", text: "كم السعر؟", from: { id: "U1", username: "ahmed" } }
        }
      ]
    });
    assert(
      direct.length === 1 && direct[0].commentId === "C1" && direct[0].igId === "IG_ACCOUNT_1",
      "IG-T5: شكل Instagram Login (entry.value) يُحلَّل — value.id لا comment_id"
    );

    const viaChanges = ig.parseIgComments({
      entry: [
        {
          id: "IG_ACCOUNT_2",
          changes: [{ field: "comments", value: { comment_id: "C2", text: "شكراً" } }]
        }
      ]
    });
    assert(
      viaChanges.length === 1 && viaChanges[0].commentId === "C2",
      "IG-T5: شكل Facebook Login (changes[]) يُحلَّل دفاعياً كذلك"
    );

    // T1 — العزل: igId يُحمل مع كل حدث؛ بدونه لا يمكن نسبة الحدث لتاجره.
    assert(
      direct[0].igId === "IG_ACCOUNT_1" && viaChanges[0].igId === "IG_ACCOUNT_2",
      "IG-T1: entry[].id (مفتاح ربط التاجر) محفوظ بكل حدث — درس phone_number_id"
    );

    // T3 — is_echo: رسالتنا نحن لا تُعالَج إطلاقاً (حلقة رد ذاتي).
    const msgs = ig.parseIgMessages({
      entry: [
        {
          id: "IG_ACCOUNT_1",
          messaging: [
            { sender: { id: "U1" }, message: { mid: "M1", text: "هلا" } },
            { sender: { id: "IG_ACCOUNT_1" }, message: { mid: "M2", text: "رد البوت", is_echo: true } }
          ]
        }
      ]
    });
    assert(
      msgs.length === 1 && msgs[0].mid === "M1",
      "IG-T3: is_echo يُتجاهل — لا حلقة رد ذاتية تحرق الحصة"
    );

    // SSRF — نفس قفل whatsapp.js: مضيف خارج القائمة يُرفض قبل لصق التوكن.
    let ssrfBlocked = false;
    try {
      ig.assertIgUrlAllowed("https://evilinstagram.com/steal");
    } catch {
      ssrfBlocked = true;
    }
    assert(ssrfBlocked, "IG-SSRF: مضيف مشابه (evilinstagram.com) يُرفض — لا مطابقة بالنهاية");

    let httpBlocked = false;
    try {
      ig.assertIgUrlAllowed("http://graph.instagram.com/x");
    } catch {
      httpBlocked = true;
    }
    assert(httpBlocked, "IG-SSRF: مخطط http يُرفض قبل إرسال أي بيانات اعتماد");

    assert(
      ig.assertIgUrlAllowed("https://graph.instagram.com/v25.0/me").startsWith("https://graph.instagram.com/"),
      "IG-SSRF: المضيف الرسمي يُقبل"
    );

    // T7 — البوابة: المحوّل لا يصدّر أي مسار نشر مباشر يتجاوز review_queue.
    const wh = await import("../../functions/api/instagram/webhook.js");
    assert(
      typeof wh.onRequestGet === "function" && typeof wh.onRequestPost === "function",
      "IG: webhook.js يصدّر المصافحة والاستقبال"
    );
    const fsp = await import("node:fs/promises");
    const whSource =
      (await fsp.readFile(new URL("../../functions/api/instagram/webhook.js", import.meta.url), "utf8")) +
      (await fsp.readFile(new URL("../../functions/_lib/domain/instagram.js", import.meta.url), "utf8"));
    assert(
      whSource.includes("enqueue(") && !/\bsend\s*\(\s*env/.test(whSource),
      "IG-T7: صفر نشر مباشر من الويبهوك — كل رد يمرّ بـreview_queue (الأخطر لو كُسر)"
    );
  }

  // ── النشر بعد الاعتماد (docs/INSTAGRAM_PLAN.md §٢.٢) ────────────────────
  {
    const { publishApproved } = await import("../../functions/_lib/domain/publish.js");

    // DB وهمي: ig_connections تربط IG_A بالتاجر m_a فقط، وrecordPublishResult
    // يسجّل ما وصله.
    let recorded = null;
    const pubDb = (igOwner) => ({
      prepare(sql) {
        return {
          bind(...args) {
            return {
              first: async () => {
                if (/FROM ig_connections WHERE ig_user_id/.test(sql)) {
                  return args[0] === "IG_A"
                    ? { merchant_id: igOwner, ig_user_id: "IG_A", access_token: "tok" }
                    : null;
                }
                if (/UPDATE review_queue/.test(sql)) {
                  recorded = { error: args[0], externalId: args[1] };
                  return { id: args[3], merchant_id: args[4] };
                }
                return null;
              },
              run: async () => ({ meta: {} })
            };
          }
        };
      }
    });

    const igRow = (payload, overrides = {}) => ({
      id: 1,
      merchant_id: "m_a",
      kind: "social_reply",
      payload: JSON.stringify(payload),
      ...overrides
    });

    // النافذة انتهت ⇒ رفض قبل أي نداء لـMeta، برسالة عربية لا خطأ مزوّد غامض.
    recorded = null;
    const expired = await publishApproved(
      { DB: pubDb("m_a") },
      igRow({
        channel: "instagram",
        mode: "comment_reply",
        igId: "IG_A",
        commentId: "C1",
        draft: "أهلين",
        expiresAt: new Date(Date.now() - 1000).toISOString()
      })
    );
    assert(
      expired.published === false && /فات وقت الرد/.test(expired.error || ""),
      "PUB-1: عنصر فاتت نافذته يُرفض برسالة عربية قبل نداء Meta"
    );

    // عدم تطابق التاجر ⇒ رفض. حمولة تشير لحساب إنستغرام يملكه تاجر آخر لا يجوز
    // أن ترسل باسمه — هذا تسريب عبر المستأجرين لو مرّ.
    recorded = null;
    const mismatch = await publishApproved(
      { DB: pubDb("m_OTHER") },
      igRow({
        channel: "instagram",
        mode: "comment_reply",
        igId: "IG_A",
        commentId: "C1",
        draft: "أهلين"
      })
    );
    assert(
      mismatch.published === false && /عدم تطابق/.test(mismatch.error || ""),
      "PUB-2: حساب إنستغرام يخص تاجراً آخر ⇒ رفض الإرسال (عزل)"
    );

    // حساب غير مربوط ⇒ رسالة عربية واضحة، لا استثناء يتسرب للمستدعي.
    recorded = null;
    const unlinked = await publishApproved(
      { DB: pubDb("m_a") },
      igRow({ channel: "instagram", mode: "dm", igId: "IG_UNKNOWN", recipientId: "U1", draft: "x" })
    );
    assert(
      unlinked.published === false && /غير مربوط/.test(unlinked.error || ""),
      "PUB-3: حساب غير مربوط ⇒ خطأ عربي مسجّل، بلا رمي للمستدعي"
    );

    // قناة غير مدعومة ⇒ رفض صريح لا نشر صامت.
    recorded = null;
    const badChannel = await publishApproved(
      { DB: pubDb("m_a") },
      igRow({ channel: "tiktok", draft: "x" })
    );
    assert(
      badChannel.published === false && /قناة غير مدعومة/.test(badChannel.error || ""),
      "PUB-4: قناة غير مدعومة تُرفض صراحةً"
    );

    // نوع بلا وجهة خارجية (تقرير) ⇒ الاعتماد نفسه هو النتيجة.
    const report = await publishApproved(
      { DB: pubDb("m_a") },
      { id: 9, merchant_id: "m_a", kind: "report", payload: "{}" }
    );
    assert(
      report.published === true && report.externalId === null,
      "PUB-5: التقرير لا وجهة نشر خارجية له — الاعتماد يكفي"
    );

    // فشل النشر يُسجَّل ولا يُرمى — الاعتماد البشري لا يُبطله عطل شبكة.
    assert(
      typeof mismatch.error === "string" && mismatch.published === false,
      "PUB-6: فشل النشر يعود كنتيجة مسجّلة، لا كاستثناء يُبطل الاعتماد"
    );
  }
}

main()
  .then(() => done())
  .catch((e) => {
    console.error("❌ Tests threw an exception:");
    console.error(e);
    process.exit(1);
  });

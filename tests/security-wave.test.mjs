// tests/security-wave.test.mjs — الدفعة أ (الأمن) من تقييم 2026-09-09.
// اختبار سلوكي لكل بند: N1–N10 · Q1 · Q2 · Q3 · U6.
// بلا شبكة إطلاقاً: env/DB/KV/fetch كلها محاكاة محلية. نفس أسلوب api.test.mjs
// (دالة assert محلية · ملخص PASS/FAIL · exit 1 عند أي فشل).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  assertPublicHttpsUrl,
  fetchExternalImage,
  turnstileRequired,
  EMAIL_RE,
  MAX_REMOTE_IMAGE_BYTES
} from "../functions/_lib/core/security.js";
import { checkRateLimit } from "../functions/_lib/core/rateLimit.js";
import { timingSafeEqualStr } from "../functions/_lib/core/crypto.js";
import { hashOtp } from "../functions/_lib/core/auth.js";
import { bumpSessionVersion, RESERVED_STORE_IDS } from "../functions/_lib/core/session.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// ── محاكيات ────────────────────────────────────────────────────────────────
function kvOk() {
  const store = new Map();
  return {
    get: async (k) => (store.has(k) ? store.get(k) : null),
    put: async (k, v) => void store.set(k, v),
    delete: async (k) => void store.delete(k)
  };
}
function kvBroken() {
  return {
    get: async () => {
      throw new Error("KV unavailable");
    },
    put: async () => {
      throw new Error("KV unavailable");
    }
  };
}
/** جامع سجلات: logError يكتب على console.error — نلتقطه بدل شبكة أو D1. */
function captureLogs(fn) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.map(String).join(" "));
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.error = original;
    })
    .then((value) => ({ value, lines }));
}

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

  console.log("Security wave (الدفعة أ) — starting...\n");

  // ── N1: support.js لا يثق بـstoreId من الجسم ──────────────────────────────
  {
    const support = read("functions/api/support.js");
    assert(
      !/^\s*const merchantId = \(body\.storeId \|\| "hala"\)/m.test(support),
      'N1-1: اختفى `body.storeId || "hala"` بلا تحقق'
    );
    assert(
      /resolveWidgetStoreId\(env, body\.storeId\)/.test(support),
      "N1-2: المعرّف يمر بدالة تحقق قبل أي استخدام"
    );
    assert(
      /getMerchant\(env, raw\)/.test(support),
      "N1-3: التحقق يقرأ صف merchants حقيقياً من core/db.js"
    );
    assert(
      /NON_WIDGET_STORE_IDS[\s\S]{0,120}style_library[\s\S]{0,60}default-store/.test(support),
      "N1-4: المعرّفات المحجوزة (RESERVED + style_library + default-store) مرفوضة"
    );
    assert(
      /INVALID_STORE_ID/.test(support) && /معرّف المتجر غير صالح/.test(support),
      "N1-5: الرفض ٤٠٠ برسالة عربية وكود INVALID_STORE_ID"
    );
    assert(
      /!env\?\.DB[\s\S]{0,200}STORE_LOOKUP_UNAVAILABLE/.test(support),
      "N1-6: تعذر التحقق (لا قاعدة بيانات) = رفض، لا قبول (fail-closed)"
    );
    assert(
      !/resolveStoreId|getSessionMerchantId/.test(support),
      "N1-7: لا اعتماد على الجلسة — الودجت عام بالتصميم"
    );
    assert(RESERVED_STORE_IDS.has("hala"), "N1-8: RESERVED_STORE_IDS مُصدَّرة وتضم hala");
  }

  // ── U6: لا رقم واتساب افتراضي بالكود ──────────────────────────────────────
  {
    const support = read("functions/api/support.js");
    assert(!/966545149591/.test(support), "U6-1: الرقم الافتراضي 966545149591 محذوف");
    assert(
      /env\.STORE_WA_PHONE[\s\S]{0,60}\|\| null/.test(support),
      "U6-2: غياب STORE_WA_PHONE = null (لا رقم مخترع)"
    );
    assert(
      /if \(wantsWhatsApp && waPhone\)/.test(support),
      "U6-3: بلا رقم مضبوط لا يُبنى رابط تحويل أصلاً (fail-closed)"
    );
  }

  // ── N2: assertPublicHttpsUrl + fetchExternalImage ─────────────────────────
  {
    const ok = (u) => {
      try {
        assertPublicHttpsUrl(u);
        return true;
      } catch {
        return false;
      }
    };
    assert(ok("https://cdn.salla.sa/images/p.jpg"), "N2-1: عنوان https عام مقبول");
    assert(!ok("http://cdn.salla.sa/p.jpg"), "N2-2: http مرفوض");
    assert(!ok("file:///etc/passwd"), "N2-3: file: مرفوض");
    assert(!ok("data:image/png;base64,AAAA"), "N2-4: data: مرفوض");
    assert(!ok("https://user:pass@cdn.example.com/p.jpg"), "N2-5: بيانات اعتماد بالـURL مرفوضة");
    assert(!ok("https://169.254.169.254/latest/meta-data/"), "N2-6: IPv4 حرفي (ميتاداتا سحابية) مرفوض");
    assert(!ok("https://10.0.0.5/p.jpg"), "N2-7: IP شبكة داخلية مرفوض");
    assert(!ok("https://[::1]/p.jpg"), "N2-8: IPv6 حرفي مرفوض");
    assert(!ok("https://localhost/p.jpg"), "N2-9: localhost مرفوض");
    assert(!ok("https://db.internal/p.jpg"), "N2-10: نطاق .internal مرفوض");
    assert(!ok("https://printer.local/p.jpg"), "N2-11: نطاق .local مرفوض");
    assert(!ok("not a url"), "N2-12: عنوان غير صالح مرفوض");

    // fetchExternalImage — الحدود بعد الجلب (fetch محاكى، بلا شبكة)
    const realFetch = globalThis.fetch;
    const mockRes = (headers, byteLength = 10) => ({
      ok: true,
      status: 200,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      arrayBuffer: async () => new ArrayBuffer(byteLength)
    });

    globalThis.fetch = async () => mockRes({ "content-type": "image/jpeg", "content-length": "12" }, 12);
    const good = await fetchExternalImage("https://cdn.example.com/p.jpg");
    assert(good.buffer.byteLength === 12 && good.contentType === "image/jpeg", "N2-13: صورة سليمة تُقبل مع نوعها");

    globalThis.fetch = async () =>
      mockRes({ "content-type": "image/jpeg", "content-length": String(MAX_REMOTE_IMAGE_BYTES + 1) });
    let threw = false;
    await fetchExternalImage("https://cdn.example.com/big.jpg").catch(() => (threw = true));
    assert(threw, "N2-14: Content-Length فوق ٨ ميجابايت مرفوض قبل القراءة");

    globalThis.fetch = async () => mockRes({ "content-type": "text/html" });
    threw = false;
    await fetchExternalImage("https://cdn.example.com/x").catch(() => (threw = true));
    assert(threw, "N2-15: content-type غير image/* مرفوض");

    // بلا Content-Length: الحد يُفرض على الحجم الفعلي بعد القراءة
    globalThis.fetch = async () => mockRes({ "content-type": "image/png" }, MAX_REMOTE_IMAGE_BYTES + 5);
    threw = false;
    await fetchExternalImage("https://cdn.example.com/x.png").catch(() => (threw = true));
    assert(threw, "N2-16: رد بلا Content-Length لا يُعفى من حد الحجم");

    // fetch لا يُستدعى أصلاً لعنوان مرفوض
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return mockRes({ "content-type": "image/png" });
    };
    await fetchExternalImage("https://127.0.0.1/x.png").catch(() => {});
    assert(!called, "N2-17: عنوان داخلي لا يصل لمرحلة fetch إطلاقاً");
    globalThis.fetch = realFetch;

    const gateway = read("functions/_lib/ai/gateway.js");
    assert(
      /fetchExternalImage\(imageUrl\)/.test(gateway) && !/const res = await fetch\(imageUrl\)/.test(gateway),
      "N2-18: askVisionAI يستخدم البوابة بدل fetch الخام"
    );
    const provider = read("functions/_lib/imageProvider.js");
    assert(
      /fetchExternalImage\(url\)/.test(provider) && !/await fetch\(url\)/.test(provider),
      "N2-19: imageProvider يمرر رابط المزوّد الاحتياطي بنفس البوابة"
    );
  }

  // ── N3: rateLimit fail-closed ─────────────────────────────────────────────
  {
    const openNoKv = await checkRateLimit({}, "1.1.1.1", "support_chat", 5, 60);
    assert(openNoKv.allowed === true, "N3-1: بلا KV الافتراضي fail-open (قرار P28 محفوظ)");

    const closedNoKv = await captureLogs(() =>
      checkRateLimit({}, "1.1.1.1", "login_attempt", 5, 60, { failClosed: true })
    );
    assert(closedNoKv.value.allowed === false, "N3-2: failClosed بلا KV = رفض");
    assert(
      closedNoKv.lines.some((l) => l.includes("RATE_LIMIT_KV_MISSING")),
      "N3-3: غياب KV يُسجَّل بكود صريح"
    );

    const closedBroken = await captureLogs(() =>
      checkRateLimit({ HALA_CACHE: kvBroken() }, "1.1.1.1", "login_attempt", 5, 60, { failClosed: true })
    );
    assert(closedBroken.value.allowed === false, "N3-4: failClosed مع خطأ قراءة KV = رفض");
    assert(
      closedBroken.lines.some((l) => l.includes("failing closed")),
      "N3-5: الخطأ يُسجَّل موسوماً failing closed"
    );

    const openBroken = await captureLogs(() =>
      checkRateLimit({ HALA_CACHE: kvBroken() }, "1.1.1.1", "support_chat", 5, 60)
    );
    assert(openBroken.value.allowed === true, "N3-6: بلا failClosed يبقى السلوك fail-open");

    // العدّ الطبيعي لم ينكسر
    const kv = kvOk();
    const env = { HALA_CACHE: kv };
    let last;
    for (let i = 0; i < 3; i++) last = await checkRateLimit(env, "2.2.2.2", "login_attempt", 2, 60, { failClosed: true });
    assert(last.allowed === false, "N3-7: تجاوز الحد يرفض كالمعتاد مع failClosed");

    // كل مسارات المصادقة الثمانية مُطبَّق عليها
    const authFiles = {
      "login.js": "login_attempt",
      "signup.js": "signup",
      "forgot_password.js": "forgot_password",
      "reset_password.js": "reset_password",
      "google.js": "google_auth",
      "complete_account.js": "complete_account",
      "verify_email.js": "verify_email",
      "send_verification.js": "send_verification"
    };
    for (const [file, key] of Object.entries(authFiles)) {
      const src = read(`functions/api/auth/${file}`);
      const re = new RegExp(`"${key}"[^)]*failClosed: true`);
      assert(re.test(src), `N3-8/${file}: ${key} يعمل fail-closed`);
    }
  }

  // ── N4/N5: فصل القراءة عن الكتابة ─────────────────────────────────────────
  {
    const ctx = read("functions/api/store/context.js");
    assert(/requireCompletedAccount/.test(ctx), "N4-1: context.js يستورد بوابة الكتابة");
    assert(
      /const isWrite = body\.dialect !== undefined \|\| body\.instructions !== undefined/.test(ctx),
      "N4-2: الكتابة تُميَّز صراحةً عن القراءة"
    );
    assert(
      /isWrite[\s\S]{0,120}requireCompletedAccount\(request, env, body\.storeId\)[\s\S]{0,200}resolveStoreId\(request, env, body\.storeId\)/.test(ctx),
      "N4-3: الكتابة → requireCompletedAccount، القراءة → resolveStoreId"
    );
    assert(/store-gate-ok: قراءة فقط/.test(ctx), "N4-4: تعليق store-gate-ok محصور بمسار القراءة");

    const logo = read("functions/api/store/logo.js");
    assert(/requireCompletedAccount/.test(logo), "N5-1: logo.js يستورد بوابة الكتابة");
    assert(
      /const merchantId = incoming[\s\S]{0,120}requireCompletedAccount/.test(logo),
      "N5-2: حفظ الشعار خلف حساب مكتمل"
    );
    assert(/store-gate-ok: قراءة الشعار فقط/.test(logo), "N5-3: قراءة الشعار تبقى على البوابة القديمة");
    assert(!/بلا كتابة ولا AI\n\s*const merchantId = await resolveStoreId/.test(logo), "N5-4: التعليق المضلّل القديم أُزيل");
  }

  // ── N6: حد معدل النشر ─────────────────────────────────────────────────────
  {
    const pub = read("functions/api/store/publish.js");
    assert(
      /checkRateLimit\(env, clientIp\(request\), "publish", 30, 60\)/.test(pub),
      "N6-1: checkRateLimit(env, clientIp(request), \"publish\", 30, 60) موجود"
    );
    assert(
      /publishRate\.allowed[\s\S]{0,200}429/.test(pub),
      "N6-2: التجاوز يرجّع ٤٢٩ برسالة عربية"
    );
    assert(
      pub.indexOf("checkRateLimit") < pub.indexOf("requireCompletedAccount("),
      "N6-3: الحد يسبق أي عمل ثقيل"
    );
  }

  // ── N7: Turnstile إلزامي عند وجود المفتاح ─────────────────────────────────
  {
    assert(turnstileRequired({ TURNSTILE_SECRET_KEY: "k" }) === true, "N7-1: وجود السر ⇒ التوكن إلزامي");
    assert(turnstileRequired({}) === false, "N7-2: غياب السر ⇒ السلوك القديم");
    assert(turnstileRequired(null) === false, "N7-3: env غائب لا يرمي");

    const login = read("functions/api/auth/login.js");
    assert(
      /if \(turnstileRequired\(env\) \|\| body\.turnstileToken\)/.test(login),
      "N7-4: login.js — الشرط لم يعد بيد العميل"
    );
    const support = read("functions/api/support.js");
    assert(
      /if \(turnstileRequired\(env\) \|\| body\.turnstileToken\)/.test(support),
      "N7-5: support.js — سطر الشرط فقط، بلا مساس بالباقي"
    );
    // مع مفتاح مضبوط وبلا توكن ⇒ verifyTurnstileToken يفشل ⇒ ٤٠٠
    const { verifyTurnstileToken } = await import("../functions/_lib/core/security.js");
    const res = await verifyTurnstileToken({ TURNSTILE_SECRET_KEY: "k" }, "", "1.1.1.1");
    assert(res.success === false, "N7-6: مفتاح مضبوط + توكن غائب = فشل تحقق (⇒ 400)");
  }

  // ── N8: لا بريد بالسجلات ──────────────────────────────────────────────────
  {
    const forgot = read("functions/api/auth/forgot_password.js");
    assert(!/^\s*console\.warn\(/m.test(forgot), "N8-1: console.warn محذوف من forgot_password");
    assert(/RESET_OTP_NOT_DELIVERED/.test(forgot), "N8-2: بديله logError بكود مهيكل");
    assert(
      !/code: "RESET_OTP_NOT_DELIVERED"[\s\S]{0,200}email/.test(forgot),
      "N8-3: السجل لا يحمل البريد ولا الرمز"
    );
  }

  // ── N9: HSTS ──────────────────────────────────────────────────────────────
  {
    const headers = read("_headers");
    const globalBlock = headers.split(/^\/(?!\*)/m)[0];
    assert(
      /Strict-Transport-Security: max-age=31536000; includeSubDomains/.test(headers),
      "N9-1: رأس HSTS موجود بالقيمة المطلوبة"
    );
    assert(/\/\*\n[\s\S]*?Strict-Transport-Security/.test(globalBlock), "N9-2: مُعرَّف تحت /* (كل المسارات)");
  }

  // ── N10: لا بيانات مفبركة ─────────────────────────────────────────────────
  {
    const aura = read("functions/api/admin/aura_whatsapp.js");
    assert(!/أحمد العتيبي/.test(aura), "N10-1: العميل الوهمي محذوف");
    assert(!/cartAmountSar/.test(aura), "N10-2: مبلغ السلة المخترع محذوف");
    assert(!/تم إرسال رسالة الاسترداد بنجاح/.test(aura), "N10-3: ادعاء الإرسال الناجح محذوف");
    assert(
      /cart_recovery_sim[\s\S]{0,400}ok: false[\s\S]{0,200}NOT_AVAILABLE/.test(aura),
      "N10-4: الفرع يرد {ok:false, code:\"NOT_AVAILABLE\"}"
    );
    assert(/غير مبني حالياً/.test(aura), "N10-5: رسالة الخطأ عربية وصادقة");
  }

  // ── Q1: timingSafeEqual موحّدة ────────────────────────────────────────────
  {
    assert(timingSafeEqualStr("abc", "abc") === true, "Q1-1: المقارنة الموحّدة تطابق الصحيح");
    assert(timingSafeEqualStr("abc", "abd") === false, "Q1-2: ترفض المختلف");
    assert(timingSafeEqualStr("abc", "abcd") === false, "Q1-3: ترفض اختلاف الطول");
    for (const f of [
      "functions/_lib/core/session.js",
      "functions/_lib/core/oauthState.js",
      "functions/api/auth/reset_password.js"
    ]) {
      const src = read(f);
      assert(!/function timingSafeEqual\(/.test(src), `Q1-4/${f}: لا نسخة محلية`);
      assert(/timingSafeEqualStr/.test(src), `Q1-5/${f}: يستورد النسخة الموحّدة من core/crypto.js`);
    }
    // الجلسة ما زالت تعمل بعد التوحيد (حراسة انحدار)
    const { createSessionToken, verifySessionToken } = await import("../functions/_lib/core/session.js");
    const env = { SESSION_SECRET: "s3cr3t", HALA_CACHE: { get: async () => "0", put: async () => {} } };
    const token = await createSessionToken(env, "m_abc");
    assert((await verifySessionToken(env, token)) === "m_abc", "Q1-6: توقيع الجلسة سليم بعد التوحيد");
    assert((await verifySessionToken(env, token.slice(0, -1) + "0")) === null, "Q1-7: توقيع معطوب مرفوض");
  }

  // ── Q3: hashOtp وEMAIL_RE موحّدتان ────────────────────────────────────────
  {
    const h1 = await hashOtp("a@b.com", "123456");
    const h2 = await hashOtp("a@b.com", "123456");
    const h3 = await hashOtp("c@d.com", "123456");
    assert(h1 === h2 && /^[0-9a-f]{64}$/.test(h1), "Q3-1: hashOtp حتمية وSHA-256 hex");
    assert(h1 !== h3, "Q3-2: مملّحة بالبريد — الرمز غير قابل للنقل بين حسابين");
    for (const f of ["functions/api/auth/forgot_password.js", "functions/api/auth/reset_password.js"]) {
      const src = read(f);
      assert(!/async function hashOtp\(/.test(src), `Q3-3/${f}: لا نسخة محلية لـhashOtp`);
      assert(/from "\.\.\/\.\.\/_lib\/core\/auth\.js"/.test(src), `Q3-4/${f}: يستورد من core/auth.js`);
    }
    assert(EMAIL_RE.test("a@b.co") && !EMAIL_RE.test("a@b") && !EMAIL_RE.test("a b@c.com"), "Q3-5: EMAIL_RE تعمل");
    for (const f of ["functions/api/auth/signup.js", "functions/api/auth/complete_account.js"]) {
      const src = read(f);
      assert(!/const EMAIL_RE =/.test(src), `Q3-6/${f}: لا تعريف محلي لـEMAIL_RE`);
      assert(/EMAIL_RE.*from "\.\.\/\.\.\/_lib\/core\/security\.js"/.test(src), `Q3-7/${f}: يستورد الموحّدة`);
    }
  }

  // ── Q2: لا ابتلاع صامت بمسارات الأمن ──────────────────────────────────────
  {
    const login = read("functions/api/auth/login.js");
    assert(
      /LOGIN_DB_QUERY_FAILED/.test(login) && /LOGIN_DB_UNAVAILABLE/.test(login),
      "Q2-1: فشل D1 بتسجيل الدخول يُسجَّل بكودين مميزين"
    );
    assert(
      /LOGIN_DB_QUERY_FAILED[\s\S]{0,300}503/.test(login),
      "Q2-2: فشل D1 يرجّع ٥٠٣ عربية لا \"البريد أو كلمة المرور غير صحيحة\""
    );
    assert(
      !/WHERE email = \?"\)\.bind\(email\)\.first\(\)\.catch\(\(\) => null\)/.test(login),
      "Q2-3: `.catch(() => null)` على استعلام الهوية أُزيل"
    );
    assert(
      !/code: "LOGIN_DB_QUERY_FAILED"[\s\S]{0,160}email/.test(login),
      "Q2-4: لا بريد بأي من سجلات تسجيل الدخول"
    );

    // bumpSessionVersion: فشل KV يُسجَّل ولا يُسقط العملية
    const dbOk = {
      // logError يكتب على error_log بنفس الـbinding — نعطيه run() صامتة.
      prepare: () => ({ bind: () => ({ first: async () => ({ session_version: 7 }), run: async () => ({}) }) })
    };
    const bumped = await captureLogs(() => bumpSessionVersion({ DB: dbOk, HALA_CACHE: kvBroken() }, "m_x"));
    assert(bumped.value === 7, "Q2-5: bumpSessionVersion يكمل رغم فشل KV");
    assert(
      bumped.lines.some((l) => l.includes("SESSION_VERSION_KV_WRITE_FAILED")),
      "Q2-6: فشل كتابة KV يُسجَّل بدل ابتلاعه"
    );

    const salla = read("functions/api/webhooks/salla.js");
    assert(
      /WEBHOOK_SIGNATURE_REJECTED/.test(salla),
      "Q2-7: توقيع سلة المرفوض يُسجَّل بكود WEBHOOK_SIGNATURE_REJECTED"
    );
    assert(
      /code: "WEBHOOK_SIGNATURE_REJECTED"[\s\S]{0,200}internal: `event=/.test(salla),
      "Q2-8: السجل يحمل اسم الحدث فقط — لا جسم الطلب"
    );
    assert(
      !/logError\(context, \{[\s\S]{0,300}?WEBHOOK_SIGNATURE_REJECTED[\s\S]{0,200}?\}\);/.test(salla) ||
        !/logError\(context, \{[\s\S]{0,300}?WEBHOOK_SIGNATURE_REJECTED[\s\S]{0,200}?\}\);/
          .exec(salla)[0]
          .match(/payload|rawBody|body/),
      "Q2-9: استدعاء logError نفسه لا يمرر أي جسم طلب"
    );

    const reset = read("functions/api/auth/reset_password.js");
    assert(
      /RESET_OTP_DELETE_FAILED/.test(reset) &&
        /RESET_LOGIN_ATTEMPTS_CLEAR_FAILED/.test(reset) &&
        /RESET_OTP_ATTEMPTS_CLEAR_FAILED/.test(reset),
      "Q2-10: تنظيف ما بعد إعادة التعيين لم يعد يبتلع الأخطاء"
    );

    const session = read("functions/_lib/core/session.js");
    assert(
      /SESSION_VERSION_READ_FAILED/.test(session) && /SESSION_VERSION_KV_READ_FAILED/.test(session),
      "Q2-11: فشل قراءة نسخة الجلسة يُسجَّل (fail-closed مع أثر)"
    );
  }

  console.log(`\nTest Summary: ${passed}/${total} Passed.`);
  if (passed !== total) process.exit(1);
}

runTests().catch((e) => {
  console.error("❌ Security wave tests threw an exception:");
  console.error(e);
  process.exit(1);
});

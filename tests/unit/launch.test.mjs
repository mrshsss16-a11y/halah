import { createRunner, readComposedPage } from "../_helpers.mjs";

const { assert, done } = createRunner("launch");

async function main() {
  // ── المرحلة ٣ (docs/COMPLETION_PATH.md) — بوابة "قبل أول تاجر حقيقي" ────
  {
    const { readFileSync } = await import("node:fs");
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const { createSessionToken, verifySessionToken, bumpSessionVersion, currentSessionVersion } = await import("../../functions/_lib/core/session.js");
    const { assertTrustedWrite } = await import("../../functions/_lib/core/csrf.js");
    const { withApi } = await import("../../functions/_lib/core/respond.js");

    // P40 — إبطال الجلسات: نسخة الحساب تُضمَّن بالتوقيع؛ الرفع يقتل كل توكن أقدم.
    const versions = new Map([["m_v", 0]]);
    const kvStore = new Map();
    const vEnv = {
      SESSION_SECRET: "test-secret-12345",
      HALA_CACHE: { get: async (k) => kvStore.get(k) ?? null, put: async (k, v) => { kvStore.set(k, v); }, delete: async () => {} },
      DB: {
        prepare(sql) {
          return {
            bind(...args) {
              return {
                first: async () => {
                  if (/SELECT session_version FROM accounts/.test(sql)) return versions.has(args[0]) ? { session_version: versions.get(args[0]) } : null;
                  if (/UPDATE accounts SET session_version = session_version \+ 1/.test(sql)) {
                    if (!versions.has(args[0])) return null;
                    versions.set(args[0], versions.get(args[0]) + 1);
                    return { session_version: versions.get(args[0]) };
                  }
                  return null;
                },
                run: async () => ({ meta: {} })
              };
            }
          };
        }
      }
    };
    const tokV0 = await createSessionToken(vEnv, "m_v");
    assert((await verifySessionToken(vEnv, tokV0)) === "m_v", "P40-1: توكن بالنسخة الحالية يمرّ");
    await bumpSessionVersion(vEnv, "m_v");
    assert((await verifySessionToken(vEnv, tokV0)) === null, "P40-2: بعد الرفع (خروج/إعادة تعيين/تعطيل) التوكن القديم يموت فوراً");
    const tokV1 = await createSessionToken(vEnv, "m_v");
    assert((await verifySessionToken(vEnv, tokV1)) === "m_v" && tokV1.split(".")[2] === "1", "P40-3: توكن جديد يحمل النسخة ١ ويمرّ");
    // توكن قديم الشكل (٣ أجزاء) = نسخة ٠ فقط
    kvStore.clear(); versions.set("m_legacy", 0);
    const legacyPayload = "m_legacy.9999999999";
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("test-secret-12345"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(legacyPayload)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    assert((await verifySessionToken(vEnv, `${legacyPayload}.${mac}`)) === "m_legacy", "P40-4: توكن ما قبل الهجرة (٣ أجزاء) يمرّ ما دامت النسخة ٠ — لا طرد جماعي بالنشر");
    await bumpSessionVersion(vEnv, "m_legacy");
    assert((await verifySessionToken(vEnv, `${legacyPayload}.${mac}`)) === null, "P40-5: أول رفع يقتل التوكنات القديمة الشكل أيضاً");
    // تاجر بلا صف accounts (سلة Easy-Mode) = نسخة ٠
    kvStore.clear();
    assert((await currentSessionVersion(vEnv, "m_no_account")) === 0, "P40-6: تاجر بلا حساب نسخته ٠ (معرّفه هو اعتماده الوحيد)");
    // فشل D1 وKV معاً = fail closed
    const deadEnv = { SESSION_SECRET: "test-secret-12345", DB: { prepare() { throw new Error("D1 down"); } } };
    assert((await verifySessionToken(deadEnv, tokV1)) === null, "P40-7: تعذّر تأكيد النسخة (D1 وKV) = لا جلسة — fail closed");
    // لا توكن قديم يبقى بعد الخروج: logout يرفع النسخة فعلاً
    const logoutSrc = read("../../functions/api/auth/logout.js");
    const resetSrc = read("../../functions/api/auth/reset_password.js");
    const accountsSrc = read("../../functions/api/admin/accounts.js");
    assert(/bumpSessionVersion\(env, merchantId\)/.test(logoutSrc) && /bumpSessionVersion\(env, owner\)/.test(resetSrc) && /if \(body\.disabled\) await bumpSessionVersion/.test(accountsSrc),
      "P40-8: الخروج وإعادة التعيين والتعطيل ترفع النسخة (الأحداث الثلاثة بالخطة)");

    // P42 — CSRF: Origin غريب يُرفض، نموذج text/plain يُرفض، نفس الأصل وإطار سلة يمرّان.
    const mk = (headers, body = '{"a":1}') => new Request("https://halah.aura.sa/api/x", { method: "POST", headers, body });
    const throwsCode = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };
    assert(throwsCode(() => assertTrustedWrite(mk({ Origin: "https://evil.example", "Content-Type": "application/json" }), {})) === "CSRF_REJECTED", "P42-1: Origin غريب → CSRF_REJECTED");
    assert(throwsCode(() => assertTrustedWrite(mk({ Origin: "https://halah.aura.sa", "Content-Type": "text/plain" }), {})) === "UNSUPPORTED_MEDIA_TYPE", "P42-2: نموذج enctype=text/plain → 415 حتى من نفس الأصل");
    assert(throwsCode(() => assertTrustedWrite(mk({ Origin: "https://halah.aura.sa", "Content-Type": "application/json" }), {})) === null, "P42-3: نفس الأصل + JSON يمرّ");
    assert(throwsCode(() => assertTrustedWrite(mk({ Origin: "https://s.salla.sa", "Content-Type": "application/json" }), {})) === null, "P42-4: إطار سلة يمرّ");
    assert(throwsCode(() => assertTrustedWrite(mk({ Origin: "https://abc123.hala-ai-os.pages.dev", "Content-Type": "application/json" }), {})) === null, "P42-5: نشرة معاينة تمرّ");
    assert(throwsCode(() => assertTrustedWrite(mk({ "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" }), {})) === "CSRF_REJECTED", "P42-6: Sec-Fetch-Site=cross-site بلا Origin → مرفوض");
    assert(throwsCode(() => assertTrustedWrite(new Request("https://halah.aura.sa/api/x", { method: "POST" }), {})) === null, "P42-7: عميل غير متصفح بلا Origin ولا جسم (cron-worker/curl) يمرّ — لا كوكي ضحية معه");
    assert(throwsCode(() => assertTrustedWrite(new Request("https://halah.aura.sa/api/x", { method: "GET", headers: { Origin: "https://evil.example" } }), {})) === null, "P42-8: GET لا يُفحص (لا تغيير حالة)");
    assert(throwsCode(() => assertTrustedWrite(mk({ Origin: "https://evil-facebook.com", "Content-Type": "application/json" }), { TRUSTED_ORIGINS: "https://partner.example" })) === "CSRF_REJECTED", "P42-9: TRUSTED_ORIGINS لا تفتح ما لم يُدرَج حرفياً");
    // سلوكياً عبر withApi: الرد 403 عربي بلا تنفيذ المعالج
    let handlerRan = false;
    const guarded = withApi(async () => { handlerRan = true; return { ok: true }; });
    const csrfRes = await guarded({ request: mk({ Origin: "https://evil.example", "Content-Type": "application/json" }), env: {}, waitUntil() {} });
    const csrfBody = await csrfRes.json();
    assert(csrfRes.status === 403 && csrfBody.code === "CSRF_REJECTED" && handlerRan === false && /مصدر غير موثوق/.test(csrfBody.error), "P42-10: withApi يرفض قبل تنفيذ المعالج برسالة عربية + requestId");
    // المرحلة ٤: signup/login/logout/me/complete_account صارت withApi، فالبوابة
    // تُطبَّق مرة واحدة داخل الغلاف بدل استدعاء يدوي بكل ملف (نفس الرد ٤٠٣).
    for (const f of ["signup", "login", "logout", "me", "complete_account"]) {
      const src = read(`../../functions/api/auth/${f}.js`);
      assert(/export const onRequestPost = withApi\(/.test(src) && !/assertTrustedWrite/.test(src), `P42-11: auth/${f} يمرّ بحارس CSRF عبر withApi (بلا استدعاء يدوي)`);
    }

    // P38 طبقة ٢ — حرق رمز تحقق البريد بعد ٥ محاولات، والعدّ ذرّي قبل المقارنة.
    // المرحلة ٤: الـSQL انتقل لـdomain/auth.js، والقرار (الحرق بعد ٥) بقي بنقطة الدخول.
    const verifySrc = read("../../functions/api/auth/verify_email.js");
    const verifyDomainSrc = read("../../functions/_lib/domain/auth.js");
    assert(/UPDATE email_verifications SET attempts = attempts \+ 1/.test(verifyDomainSrc) && /RETURNING code_hash, attempts/.test(verifyDomainSrc) && /row\.attempts > MAX_ATTEMPTS/.test(verifySrc) && /DELETE FROM email_verifications/.test(verifyDomainSrc),
      "P38-L2-1: verify_email يعدّ المحاولة ذرّياً قبل المقارنة ويحرق الرمز بعد ٥");
    const sendSrc = read("../../functions/api/auth/send_verification.js");
    // المرحلة ٦ (ق٦): النقطة لا تستورد المحوّل — القناة تُسأل عبر `domain/auth.js`.
    assert(/EMAIL_NOT_CONFIGURED/.test(sendSrc) && /verificationChannelReady\(env\)/.test(sendSrc) && /emailConfigured\(env\)/.test(verifyDomainSrc), "P38-L2-2: بلا مزوّد بريد = 503 صريح، لا ادعاء إرسال");
    const emailMod = await import("../../functions/_lib/integrations/email.js");
    assert(emailMod.isConfigured({}) === false && emailMod.isConfigured({ RESEND_API_KEY: "k" }) === false && emailMod.isConfigured({ RESEND_API_KEY: "k", EMAIL_FROM: "x@y" }) === true, "P38-L2-3: محوّل البريد fail-closed بلا السرّين");
    let emailThrew = false;
    try { await emailMod.send({}, { to: "a@b", subject: "s", text: "t" }); } catch { emailThrew = true; }
    assert(emailThrew, "P38-L2-4: send بلا سر يرمي — لا تمرير برشاقة");
    const mig23 = read("../../migrations/0023_session_version_audit_log.sql");
    assert(/ADD COLUMN session_version/.test(mig23) && /ADD COLUMN email_verified_at/.test(mig23) && /LIKE 'm_g_%'/.test(mig23) && /CREATE TABLE IF NOT EXISTS audit_log/.test(mig23), "P38-L2-5: هجرة 0023 — نسخة الجلسة + تحقق البريد (Google متحقَّق سلفاً) + audit_log");

    // P21 — الويبهوك بحد معدل بعد التوقيع.
    // المرحلة ٦ (ق٦): التحقق يمرّ بـ`domain/whatsappInbound.js` لا بالمحوّل مباشرة.
    const waSrc = read("../../functions/api/whatsapp/webhook.js");
    const sigIdx = waSrc.indexOf("verifyInboundSignature(");
    const rlIdx = waSrc.indexOf('checkRateLimit(env, clientIp(request), "wa_webhook"');
    assert(sigIdx > 0 && rlIdx > sigIdx && /WA_WEBHOOK_RATE_LIMITED/.test(waSrc), "P21: حد معدل على الويبهوك الموقّع (٦٠٠/دقيقة) بعد التحقق من التوقيع");

    // P45 — تثبيت المضيف: fetch لا يُستدعى إطلاقاً لمضيف غريب (mock عالمي).
    const { assertWaUrlAllowed, getWaMedia } = await import("../../functions/_lib/integrations/whatsapp.js");
    assert(throwsCode(() => assertWaUrlAllowed("https://evil.example/x")) !== null || (() => { try { assertWaUrlAllowed("https://evil.example/x"); return false; } catch { return true; } })(), "P45-1: مضيف غريب يُرفض قبل أي طلب");
    assert((() => { try { assertWaUrlAllowed("http://graph.facebook.com/x"); return false; } catch { return true; } })(), "P45-2: http (بلا s) يُرفض حتى لمضيف مسموح");
    assert(assertWaUrlAllowed("https://graph.facebook.com/v21.0/123").startsWith("https://graph.facebook.com/"), "P45-3: مضيف Graph المسموح يمرّ");
    const realFetch = globalThis.fetch;
    const fetchedHosts = [];
    globalThis.fetch = async (url) => {
      fetchedHosts.push(new URL(String(url)).hostname);
      // meta lookup returns a media URL on a FOREIGN host — the download step must refuse before fetching it
      return new Response(JSON.stringify({ url: "https://evil.example/media.ogg" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    let mediaErr = null;
    try { await getWaMedia({ WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_ID: "p" }, "media123"); } catch (e) { mediaErr = e; }
    globalThis.fetch = realFetch;
    assert(mediaErr && fetchedHosts.length === 1 && fetchedHosts[0] === "graph.facebook.com" && !fetchedHosts.includes("evil.example"),
      "P45-4: رابط وسائط يشير لمضيف غريب — fetch لا يُستدعى له أبداً، والتوكن لا يغادر");

    // P9 — سطر تدقيق بكل نقطة أدمن.
    const { readdirSync } = await import("node:fs");
    const adminDir = new URL("../../functions/api/admin/", import.meta.url);
    const adminFiles = readdirSync(adminDir).filter((n) => n.endsWith(".js"));
    const missingAudit = adminFiles.filter((n) => !/recordAdminAction\(context/.test(readFileSync(new URL(n, adminDir), "utf8")));
    assert(adminFiles.length >= 9 && missingAudit.length === 0, `P9: كل نقاط الأدمن (${adminFiles.length}) تسجّل سطر تدقيق (الناقص: ${missingAudit.join(", ") || "لا شيء"})`);
    const { recordAdminAction } = await import("../../functions/_lib/core/auditLog.js");
    let auditRow = null;
    const auditCtx = { env: { DB: { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { if (/INSERT INTO audit_log/.test(sql)) auditRow = a; return {}; } }) }) } }, waitUntil(p) { this._p = p; } };
    recordAdminAction(auditCtx, { admin: { email: "admin@aura.sa" }, action: "setDisabled", path: "/api/admin/accounts", targetMerchantId: "m_x", requestId: "r1" });
    await auditCtx._p;
    assert(auditRow && auditRow[0] === "admin@aura.sa" && auditRow[1] === "setDisabled" && auditRow[3] === "m_x", "P9-2: السطر يحمل الأدمن والفعل والمتجر الهدف — بلا PII");

    // P57 + CSP — حراس الارتداد تعمل فعلاً (لا تمرير فارغ).
    const secSrc = read("../../functions/_lib/core/security.js");
    assert(!/'unsafe-eval'/.test(secSrc), "P56: 'unsafe-eval' أُزيل من CSP الردود");
    assert(/audit-security\.mjs/.test(read("../../package.json")), "ح٢-ح٨: تدقيق الأمن مربوط بـnpm test");
  }

  // ── المرحلة ٤ (docs/COMPLETION_PATH.md 4.3/4.5) — متابعة الإطلاق ─────────
  {
    const { readFileSync } = await import("node:fs");
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const { touchLastActive } = await import("../../functions/_lib/core/session.js");
    const { launchStats, saveMerchantFeedback } = await import("../../functions/_lib/domain/analytics.js");

    // LAUNCH-1 — last_active_at مخنوق بـKV: مفتاح موجود = صفر كتابة D1؛ غيابه = كتابة واحدة + وضع المفتاح.
    let writes = 0; let kvPuts = 0;
    const mkEnv = (kvHas) => ({
      HALA_CACHE: { get: async () => (kvHas ? "1" : null), put: async () => { kvPuts++; } },
      DB: { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { if (/UPDATE merchants SET last_active_at/.test(sql) && a[0] === "m_t") writes++; return {}; } }) }) }
    });
    touchLastActive(mkEnv(true), "m_t"); await new Promise((r) => setTimeout(r, 10));
    assert(writes === 0 && kvPuts === 0, "LAUNCH-1a: مفتاح KV حاضر → لا كتابة D1 (خنق ١٠ دقائق)");
    touchLastActive(mkEnv(false), "m_t"); await new Promise((r) => setTimeout(r, 10));
    assert(writes === 1 && kvPuts === 1, "LAUNCH-1b: بلا مفتاح → كتابة واحدة مقيّدة بـid + وضع المفتاح");
    assert(/touchLastActive\(env, sessionMerchantId\)/.test(read("../../functions/_lib/core/session.js")), "LAUNCH-1c: resolveStoreId يلمس last_active_at عند أي طلب بجلسة");

    // LAUNCH-2 — التغذية الراجعة معزولة بالتاجر ومحدودة ١-٥.
    let fbBind = null;
    const fbEnv = { DB: { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { if (/INSERT INTO merchant_feedback/.test(sql)) fbBind = a; return { meta: { last_row_id: 7 } }; } }) }) } };
    const fbId = await saveMerchantFeedback(fbEnv, { merchantId: "m_f", score: 4, comment: "ممتاز", context: "studio" });
    assert(fbId === 7 && fbBind[0] === "m_f" && fbBind[1] === 4, "LAUNCH-2a: saveMerchantFeedback يكتب merchant_id من الجلسة والدرجة");
    const fbSrc = read("../../functions/api/store/feedback.js");
    assert(/score < 1 \|\| score > 5/.test(fbSrc) && /resolveMerchantStoreId\(request, env, body\.storeId\)/.test(fbSrc) && /checkRateLimit/.test(fbSrc), "LAUNCH-2b: endpoint التغذية الراجعة يرفض خارج ١-٥، بهوية الجلسة، وبحد معدل");

    // LAUNCH-3 — الصدق: لا رقم مبيعات مخترع بلوحة الأدمن.
    const adminHtml = await readComposedPage("admin");
    assert(!/14,250/.test(adminHtml) && !/kpiCartSar/.test(adminHtml) && /kpiActive7d/.test(adminHtml), "LAUNCH-3: مؤشر «+14,250 ر.س» المفبرك أُزيل من لوحة الأدمن (قاعدة الصدق §11) وحلّ محله نشاط حقيقي");
    assert(/id="sectionLaunch"/.test(adminHtml) && /\/api\/admin\/launch/.test(adminHtml), "LAUNCH-3b: تبويب الإطلاق موجود بلوحة الأدمن");

    // LAUNCH-4 — launchStats أرقام حقيقية من D1 (mock) ولا تسقط عند جدول ناقص.
    const stStmt = (sql) => ({
      first: async () => { if (/omnichannel_sessions/.test(sql)) throw new Error("no such table"); if (/AVG\(score\)/.test(sql)) return { n: 2, avg: 4.5 }; return { n: 3 }; },
      all: async () => ({ results: [{ code: "X", n: 2 }] })
    });
    const stEnv = { DB: { prepare: (sql) => ({ ...stStmt(sql), bind: () => stStmt(sql) }) } };
    const st = await launchStats(stEnv);
    assert(st.activeMerchants7d === 3 && st.widgetSessions7d === null && st.feedbackAvg30d === 4.5 && st.topErrors24h[0].code === "X", "LAUNCH-4: launchStats يعيد العدّادات، وجدول غير متاح = null لا رقم مخترع");

    // LAUNCH-5 — admin/launch خلف requireAdmin + سطر تدقيق + بإعفاء التدقيق الموثّق.
    const launchSrc = read("../../functions/api/admin/launch.js");
    assert(/requireAdmin\(request, env\)/.test(launchSrc) && /recordAdminAction\(context/.test(launchSrc), "LAUNCH-5a: admin/launch محمي بـrequireAdmin ويسجّل تدقيقاً");
    assert(/functions\/api\/admin\/launch\.js/.test(read("../../scripts/audit-isolation.mjs")), "LAUNCH-5b: إعفاء admin/launch موثّق بسبب في audit-isolation");
    assert(/ADD COLUMN last_active_at/.test(read("../../migrations/0024_launch_monitoring.sql")) && /CREATE TABLE IF NOT EXISTS merchant_feedback/.test(read("../../migrations/0024_launch_monitoring.sql")), "LAUNCH-6: هجرة 0024 — last_active_at + merchant_feedback");
    const dash = await readComposedPage("dashboard");
    assert(/id="feedbackCard"/.test(dash) && /\/api\/store\/feedback/.test(dash) && /maybeShowFeedback\(\)/.test(dash), "LAUNCH-7: بطاقة التغذية الراجعة بالداشبورد تظهر بعد تفاعل حقيقي لا بالدخول الأول");
  }
}

main()
  .then(() => done())
  .catch((e) => {
    console.error("❌ Tests threw an exception:");
    console.error(e);
    process.exit(1);
  });

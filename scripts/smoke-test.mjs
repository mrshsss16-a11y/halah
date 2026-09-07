#!/usr/bin/env node
/**
 * اختبار الدخان بعد النشر (D6 — docs/PARALLEL_TRACKS.md §أ.٤).
 *
 * لماذا آلي وليس يدوياً: النشر بمشروع Pages قادر على إسقاط كل الـendpoints
 * دفعة واحدة (حدث فعلياً: `dist/_worker.js` حوّل المشروع لـAdvanced Mode
 * فتجاهل functions/ كاملاً — AGENT.md §٤). `verify-dist.mjs` يمنع ذلك السبب
 * تحديداً *قبل* الرفع، لكنه لا يثبت أن الـAPI حيّ *بعده*. هذا الملف يثبته.
 *
 * الاعتماد على تذكّر بشري لتشغيل curl بعد كل نشر خيار غير مقبول لمطوّر
 * واحد — يوم واحد نسيان = عطل صامت لا يكتشفه أحد.
 *
 * يُشغَّل تلقائياً في نهاية `npm run deploy`، أو يدوياً:
 *   node scripts/smoke-test.mjs
 *   node scripts/smoke-test.mjs https://<preview>.pages.dev   (هدف مخصص)
 *
 * خروج غير صفري = الإنتاج مكسور.
 */

const BASE = process.argv[2] || "https://hala-ai-os.pages.dev";

// النشر على شبكة Cloudflare يحتاج ثوانيَ للانتشار على الحافة. المحاولة
// الأولى قد تصيب نسخة قديمة أو غير جاهزة — لذا إعادة محاولة متدرجة بدل
// إعلان فشل كاذب يجعل الفريق يتجاهل الاختبار لاحقاً.
const RETRIES = 3;
const RETRY_DELAY_MS = 5000;

/**
 * كل فحص يمثّل فئة عطل مختلفة تماماً:
 *  - health 200      → الـFunctions تعمل أصلاً (تكشف كارثة Advanced Mode)
 *  - webhook 401     → التحقق من التوقيع نشط (تكشف انهيار الأمن الصامت،
 *                      حيث الـAPI حيّ لكنه صار مفتوحاً للجميع)
 *  - login 200       → الأصول الثابتة (dist/) مرفوعة وتُخدَم
 * فحص واحد ناجح لا يعني الباقي — لذا الثلاثة معاً، لا واحد منها كعيّنة.
 */
const CHECKS = [
  {
    name: "الـAPI حيّ",
    path: "/api/health",
    method: "GET",
    expect: 200,
    onFail: "الـFunctions لا تعمل — تحقق أن dist/ لا يحوي _worker.js (AGENT.md §٤)"
  },
  {
    name: "توقيع ويبهوك واتساب مفعّل",
    path: "/api/whatsapp/webhook",
    method: "POST",
    body: "{}",
    expect: 401,
    onFail: "⚠️ خطير: الويبهوك يقبل طلباً بلا توقيع — الأمن ساقط، لا مجرد عطل"
  },
  {
    name: "الصفحات الثابتة تُخدَم",
    path: "/login",
    method: "GET",
    expect: 200,
    onFail: "dist/ لم يُرفع بشكل صحيح أو التوجيه مكسور"
  }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runCheck(check) {
  const url = `${BASE}${check.path}`;
  const init = { method: check.method, redirect: "follow" };
  if (check.body) {
    init.body = check.body;
    init.headers = { "content-type": "application/json" };
  }

  const res = await fetch(url, init);
  return { ok: res.status === check.expect, status: res.status };
}

async function main() {
  console.log(`\n🔎 اختبار الدخان على ${BASE}\n`);

  const failures = [];

  for (const check of CHECKS) {
    let result = null;
    let lastError = null;

    for (let attempt = 1; attempt <= RETRIES; attempt++) {
      try {
        result = await runCheck(check);
        if (result.ok) break;
      } catch (err) {
        lastError = err;
        result = null;
      }
      if (attempt < RETRIES) {
        console.log(`   … ${check.name}: محاولة ${attempt}/${RETRIES} لم تنجح، إعادة بعد ${RETRY_DELAY_MS / 1000}ث`);
        await sleep(RETRY_DELAY_MS);
      }
    }

    if (result && result.ok) {
      console.log(`✔ ${check.name} (${result.status})`);
    } else {
      const got = result ? result.status : `فشل الاتصال: ${lastError?.message || "غير معروف"}`;
      console.error(`✖ ${check.name} — متوقَّع ${check.expect}، وصل ${got}`);
      console.error(`  ${check.onFail}`);
      failures.push(check.name);
    }
  }

  if (failures.length) {
    console.error(`\n✖ اختبار الدخان فشل (${failures.length}/${CHECKS.length}). الإنتاج غير سليم.`);
    console.error(`  تحقق من آخر نشرة: npx wrangler pages deployment list --project-name hala-ai-os\n`);
    return 1;
  }

  console.log(`\n✔ اختبار الدخان: ${CHECKS.length}/${CHECKS.length} — الإنتاج سليم.\n`);
  return 0;
}

process.exit(await main());

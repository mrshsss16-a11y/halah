// tests/_helpers.mjs — أدوات مشتركة بين ملفات tests/unit و tests/integration
// بعد تقسيم tests/api.test.mjs (docs/ARCHITECTURE.md §١ tests/unit، المرحلة ٥ النصف ب).
//
// الهدف: نفس أسلوب العدّ/الطباعة/الخروج المستخدَم بكل ملفات الاختبار الحالية
// (assert محلية، ملخص Test Summary: N/N، exit 1 عند أي فشل) بلا تكراره بكل ملف،
// إضافة إلى المحاكيات (KV/DB) المكرَّرة حرفياً عبر عدة أقسام من api.test.mjs.

/**
 * createRunner(name) — يرجّع {assert, done} بنفس أسلوب ملفات tests/*.test.mjs
 * الحالية: PASS/FAIL مطبوعة فوراً، عدّاد، وTest Summary أخيرة.
 */
export function createRunner(name) {
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

  function done() {
    console.log(`\nTest Summary: ${passed}/${total} Passed.`);
    if (passed !== total) process.exit(1);
    return { passed, total };
  }

  return { assert, done };
}

// P40: session tokens carry accounts.session_version, verified KV-first. This
// mirror answers "0" for everyone so token tests never need a D1 mock — and so
// tests that assert "must not reach the DB" keep meaning exactly that.
export function createSessionVersionKv() {
  return { get: async () => "0", put: async () => {}, delete: async () => {} };
}

// N3 (2026-09-09) — checkRateLimit صار fail-closed على مسارات المصادقة: بلا
// ربط KV يُرفض الطلب بـ429. بالإنتاج HALA_CACHE مربوط دائماً، فبيئات الاختبار
// التي تستدعي معالجات المصادقة تأخذ عدّاداً بالذاكرة بدل غياب الربط.
export function createRlKv() {
  const m = new Map();
  return {
    get: async (k) => m.get(k) ?? null,
    put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); }
  };
}

// KV مزيَّف عام (يُستخدم لاختبارات عزل الذاكرة المؤقتة بين التجّار).
export function fakeKv() {
  const store = new Map();
  return {
    store,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    put: async (k, v) => { store.set(k, v); },
    delete: async (k) => { store.delete(k); }
  };
}

// طلب JSON عام (POST) — يُستخدم بأكثر من ملف اختبار مصادقة.
export function jsonReq(body, headers = {}) {
  return new Request("https://x/api", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

// قراءة ملف مصدر كنص (لاختبارات "شكل الكود" — regex على السورس لا سلوكه).
export async function readSrc(relOrUrl) {
  const { readFileSync } = await import("node:fs");
  return readFileSync(relOrUrl, "utf8");
}

// SESSION_SECRET الثابت المستخدَم بكل بيئات الاختبار.
export const TEST_SESSION_SECRET = "test-secret-12345";

// ENCRYPTION_KEY الثابت لاختبارات التشفير بالراحة (`core/crypto.js`): ٣٢ بايت
// خام مرمَّزة base64 — نفس شكل السر بالإنتاج. قيمة اختبار فقط، لا تُستخدم حيّاً.
export const TEST_ENCRYPTION_KEY = btoa("0123456789abcdef0123456789abcdef");

// readComposedPage(name) — بعد تقسيم dashboard.html/admin.html إلى
// partials/<name>-*.html + public/js/<name>/*.js (docs/ARCHITECTURE.md، تقسيم
// 2026-09-09)، جذر <name>.html صار قالباً فارغاً (`<!--#include-->` فقط) —
// أي اختبار "شكل الكود" يقرأه وحده لن يجد شيئاً. هذا يعيد نص الصفحة
// *المركَّبة* بعد `npm run build`: dist/<name>.html (القالب بعد فكّ الـ
// includes) + كل وحدات dist/js/<name>/*.js مجمّعة + partials/<name>-*.html
// احتياطاً (نفس أسلوب readSrc — regex على شكل الكود، لا سلوكه).
export async function readComposedPage(name) {
  const { readFileSync, readdirSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = process.cwd();

  const distHtml = join(root, "dist", `${name}.html`);
  if (!existsSync(distHtml)) {
    throw new Error(
      `readComposedPage("${name}"): لم يُعثر على dist/${name}.html — شغّل npm run build أولاً.`
    );
  }

  const parts = [readFileSync(distHtml, "utf8")];

  const distJsDir = join(root, "dist", "js", name);
  if (existsSync(distJsDir)) {
    for (const f of readdirSync(distJsDir).sort()) {
      if (f.endsWith(".js")) parts.push(readFileSync(join(distJsDir, f), "utf8"));
    }
  }

  const partialsDir = join(root, "partials");
  if (existsSync(partialsDir)) {
    const prefix = `${name}-`;
    for (const f of readdirSync(partialsDir).sort()) {
      if (f.startsWith(prefix) && f.endsWith(".html")) {
        parts.push(readFileSync(join(partialsDir, f), "utf8"));
      }
    }
  }

  return parts.join("\n");
}

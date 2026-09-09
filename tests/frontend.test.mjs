// اختبارات المرحلة ٢ (الواجهة) — docs/ARCHITECTURE.md §٣. أسلوب tests/api.test.mjs
// وtests/ops-wave.test.mjs: دوال assert بسيطة، طباعة PASS/FAIL، exit 1 عند فشل.
// لا يلمس tests/api.test.mjs.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

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

  console.log("Starting frontend tests...\n");

  // ---- escHtml يهرّب الرموز بشكل صحيح (public/js/shared.js) ----
  {
    const src = readFileSync(join(ROOT, "public/js/shared.js"), "utf8");
    const sandbox = { window: {}, document: undefined };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    const escHtml = sandbox.window.escHtml;
    assert(typeof escHtml === "function", "shared.js يصدّر escHtml كدالة");
    assert(escHtml('<script>alert("x")</script>') === "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;", "escHtml يهرّب < > \"");
    assert(escHtml("O'Brien & Co") === "O&#39;Brien &amp; Co", "escHtml يهرّب ' و&");
    assert(escHtml(null) === "" && escHtml(undefined) === "", "escHtml يعامل null/undefined كنص فارغ");
    assert(typeof sandbox.window.apiPost === "function", "shared.js يصدّر apiPost");
    assert(typeof sandbox.window.checkSession === "function", "shared.js يصدّر checkSession");
    assert(typeof sandbox.window.showMsg === "function", "shared.js يصدّر showMsg");
    assert(typeof sandbox.window.showToast === "function", "shared.js يصدّر showToast");
  }

  // ---- كل صفحة HTML بالجذر تحوي #include partials/head-common.html ----
  {
    const rootHtmlFiles = readdirSync(ROOT).filter((n) => n.endsWith(".html"));
    assert(rootHtmlFiles.length > 0, "يوجد صفحات HTML بالجذر لفحصها");
    for (const name of rootHtmlFiles) {
      const html = readFileSync(join(ROOT, name), "utf8");
      assert(html.includes("#include partials/head-common.html"), `${name} يستدعي #include partials/head-common.html`);
    }
  }

  // ---- partials/head-common.html نفسه موجود ويحوي Tailwind + Material Symbols ----
  {
    const headCommonPath = join(ROOT, "partials/head-common.html");
    assert(existsSync(headCommonPath), "partials/head-common.html موجود");
    const html = readFileSync(headCommonPath, "utf8");
    assert(html.includes("cdn.tailwindcss.com"), "head-common يحمّل Tailwind CDN");
    assert(html.includes("Material+Symbols+Outlined"), "head-common يحمّل Material Symbols");
    assert(html.includes('charset="utf-8"'), "head-common يحوي meta charset");
  }

  // ---- بعد npm run build يحوي dist/ على js/shared.js وstyle.css و_redirects (إن احتُفظ به) ----
  {
    const distDir = join(ROOT, "dist");
    assert(existsSync(distDir), "dist/ موجود (شغّل npm run build أولاً)");
    if (existsSync(distDir)) {
      assert(existsSync(join(distDir, "js/shared.js")), "dist/js/shared.js موجود بعد البناء");
      assert(existsSync(join(distDir, "style.css")), "dist/style.css موجود بعد البناء");
      if (existsSync(join(ROOT, "_redirects"))) {
        assert(existsSync(join(distDir, "_redirects")), "dist/_redirects موجود (المصدر محتفَظ به بالجذر)");
      }
    }
  }

  console.log(`\n${passed}/${total} passed.`);
  if (passed !== total) process.exit(1);
}

runTests().catch((err) => {
  console.error("❌ Tests threw an exception:", err);
  process.exit(1);
});

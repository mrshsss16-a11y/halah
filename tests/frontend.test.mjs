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

  // ---- المرحلة ٥: تقسيم dashboard.html وadmin.html ----
  // الحجّة: بعد نقل العلامة إلى partials/ والـJS إلى وحدات ES، ينكسر الاتصال
  // بينهما بصمت — معرّف عنصر يتغيّر بملف ولا يتبعه الآخر، أو دالة تستدعيها سمة
  // onclick تبقى داخل نطاق الوحدة فلا يجدها المتصفح. الفحصان أدناه يقرآن ناتج
  // البناء (dist/، حيث كل #include مفكوك) فيغطيان الصفحة كما تصل التاجر فعلاً.
  const PAGES = [
    { html: "dashboard.html", jsDir: "js/dashboard" },
    { html: "admin.html", jsDir: "js/admin" }
  ];

  function readJsDir(dir) {
    if (!existsSync(dir)) return "";
    return readdirSync(dir).filter((n) => n.endsWith(".js")).map((n) => readFileSync(join(dir, n), "utf8")).join("\n");
  }

  {
    const distDir = join(ROOT, "dist");
    for (const page of PAGES) {
      const pagePath = join(distDir, page.html);
      if (!existsSync(pagePath)) { assert(false, `dist/${page.html} موجود بعد البناء`); continue; }
      const html = readFileSync(pagePath, "utf8");
      const js = readJsDir(join(distDir, page.jsDir));

      // (١) كل معرّف يطلبه JS بـgetElementById موجود بالـHTML المفكوك.
      const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
      const wantedIds = new Set([...js.matchAll(/getElementById\(\s*["'`]([A-Za-z][\w-]*)["'`]\s*\)/g)].map((m) => m[1]));
      // عنصر ينشئه JS نفسه ويعطيه id (سكربت FB SDK) ليس معرّفاً ناقصاً بالعلامة.
      const jsCreatedIds = new Set([...js.matchAll(/\.id\s*=\s*["'`]([A-Za-z][\w-]*)["'`]/g)].map((m) => m[1]));
      const missingIds = [...wantedIds].filter((id) => !htmlIds.has(id) && !jsCreatedIds.has(id));
      assert(wantedIds.size > 0, `${page.html}: وحدات ${page.jsDir} تطلب معرّفات عناصر (الفحص غير فارغ)`);
      assert(missingIds.length === 0, `${page.html}: كل معرّف يستدعيه JS موجود بالـHTML${missingIds.length ? " — ناقص: " + missingIds.join(", ") : ""}`);

      // (٢) كل دالة تستدعيها سمة onclick/onchange/onsubmit/onkeydown منشورة على
      //     window بـmain.js (وحدات ES لها نطاقها الخاص — بلا النشر لا تعمل).
      const handlers = new Set();
      for (const m of html.matchAll(/\son(?:click|change|submit|keydown)="([^"]*)"/g)) {
        for (const c of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) handlers.add(c[1]);
      }
      // استدعاءات JS المدمجة داخل السمة نفسها (this.remove()، JSON.parse…) ليست دوال عامة.
      const BUILTIN = new Set(["remove", "querySelector", "if", "for", "while", "switch", "return", "typeof", "String", "Number", "Boolean"]);
      const exposed = new Set();
      for (const block of js.matchAll(/Object\.assign\(\s*window\s*,\s*\{([\s\S]*?)\}\s*\)/g)) {
        const body = block[1].replace(/\/\/[^\n]*/g, ""); // تعليقات التجميع داخل الكائن
        for (const name of body.matchAll(/([A-Za-z_$][\w$]*)\s*(?::|,|$)/gm)) exposed.add(name[1]);
      }
      for (const m of js.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) exposed.add(m[1]);
      const missingFns = [...handlers].filter((fn) => !BUILTIN.has(fn) && !exposed.has(fn));
      assert(handlers.size > 0, `${page.html}: توجد سمات onclick لفحصها`);
      assert(missingFns.length === 0, `${page.html}: كل دالة تستدعيها onclick منشورة على window${missingFns.length ? " — ناقص: " + missingFns.join(", ") : ""}`);
    }
  }

  // ---- الصفحتان المقسّمتان تحوّلتا لهيكل + includes + وحدات ES ----
  {
    for (const page of PAGES) {
      const src = readFileSync(join(ROOT, page.html), "utf8");
      const lines = src.split("\n").filter((l, i, a) => !(i === a.length - 1 && l === "")).length;
      assert(lines <= 300, `${page.html} هيكل فقط (${lines} سطراً ≤ ٣٠٠)`);
      assert(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/.test(src), `${page.html} بلا أي <script> مضمّن`);
      assert(src.includes(`<script type="module" src="/${page.jsDir}/main.js"></script>`), `${page.html} يحمّل /${page.jsDir}/main.js كوحدة ES`);
    }
  }

  // ---- fonts.cdnfonts.com (500 دائم، DIN Next LT Arabic غير موجود فعلياً) —
  //      لا ذكر له بأي ملف واجهة أو بسياسة CSP (P.S. إغلاق طلب المهندس 2026-09-09) ----
  {
    const filesToCheck = [
      ...readdirSync(ROOT).filter((n) => n.endsWith(".html")).map((n) => join(ROOT, n)),
      ...readdirSync(join(ROOT, "partials")).filter((n) => n.endsWith(".html")).map((n) => join(ROOT, "partials", n)),
      ...readdirSync(join(ROOT, "styles")).filter((n) => n.endsWith(".css")).map((n) => join(ROOT, "styles", n)),
      join(ROOT, "_headers"),
      join(ROOT, "functions/_lib/core/security.js"),
      join(ROOT, "scripts/audit-security.mjs")
    ].filter((p) => existsSync(p));

    for (const filePath of filesToCheck) {
      const content = readFileSync(filePath, "utf8");
      const relPath = filePath.slice(ROOT.length + 1).replace(/\\/g, "/");
      assert(!content.includes("cdnfonts"), `${relPath}: بلا ذكر لـcdnfonts`);
      assert(!content.includes("DIN Next"), `${relPath}: بلا ذكر لخط DIN Next LT Arabic`);
    }
  }

  // ---- تقرير #9: كل <script src="https://…"> بناتج dist/ يحمل integrity+crossorigin ----
  // استثناءان موثَّقان (scripts/audit-frontend.mjs فحص هـ):
  //   - accounts.google.com/gsi/client: Cache-Control: private بلا كاش وسيط وجوجل توثّق
  //     تحديثه الصامت بلا إصدار ثابت.
  //   - cdn.tailwindcss.com: تحقّق حيّ (2026-09-11) أثبت أن هذا المضيف لا يرسل
  //     Access-Control-Allow-Origin إطلاقاً — integrity على سكربت عابر الأصل يفرض
  //     crossorigin (طلب CORS)، وبلا ACAO يرفضه المتصفح قبل التنفيذ، فيسقط Tailwind
  //     من كل صفحة. SRI مستحيلة تقنياً على هذا المضيف بلا استضافة ذاتية للملف.
  {
    const distDir = join(ROOT, "dist");
    const SRI_SKIP_HOSTS = ["accounts.google.com/gsi/client", "cdn.tailwindcss.com"];
    const distHtmlFiles = existsSync(distDir) ? readdirSync(distDir).filter((n) => n.endsWith(".html")) : [];
    assert(distHtmlFiles.length > 0, "dist/ يحوي صفحات HTML لفحص SRI (شغّل npm run build أولاً)");
    let checkedTags = 0;
    for (const name of distHtmlFiles) {
      const html = readFileSync(join(distDir, name), "utf8");
      for (const m of html.matchAll(/<script\b[^>]*\bsrc="(https:\/\/[^"]+)"[^>]*>/g)) {
        const tag = m[0];
        const src = m[1];
        if (SRI_SKIP_HOSTS.some((h) => src.includes(h))) continue;
        checkedTags++;
        assert(/\bintegrity="sha(256|384|512)-[^"]+"/.test(tag), `dist/${name}: <script src="${src}"> يحمل integrity=`);
        assert(/\bcrossorigin="anonymous"/.test(tag), `dist/${name}: <script src="${src}"> يحمل crossorigin="anonymous"`);
      }
    }
    assert(checkedTags > 0, "يوجد سكربتات خارجية بناتج البناء لفحصها (الفحص غير فارغ)");
  }

  console.log(`\n${passed}/${total} passed.`);
  if (passed !== total) process.exit(1);
}

runTests().catch((err) => {
  console.error("❌ Tests threw an exception:", err);
  process.exit(1);
});

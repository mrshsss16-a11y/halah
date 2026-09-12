// tests/unit/dashboard-auth-gate.test.mjs — يحمي إصلاح "وميض" لوحة التاجر
// (2026-09-13): زائر بلا جلسة كان يرى شكل اللوحة كاملاً للحظة قبل أن يحسم
// main.js نتيجة /api/auth/me ويحوّل لتسجيل الدخول. الإصلاح: وسم auth-pending
// يُضاف على <html> قبل أول رسم (partials/dashboard-head.html) وCSS يخفي
// <body> طالما الوسم موجود؛ main.js لا يزيله إلا بعد أن يعرف حال الجلسة، وفي
// مسار "غير مسجَّل" يغادر (تحويل/destroy) بلا إزالته أبداً.
import { createRunner, readComposedPage } from "../_helpers.mjs";
import { readFileSync } from "node:fs";

const { assert, done } = createRunner("dashboard-auth-gate");

async function main() {
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
  const headSrc = read("../../partials/dashboard-head.html");
  const mainSrc = read("../../public/js/dashboard/main.js");
  const dash = await readComposedPage("dashboard");

  // ── الوسم يُضاف بأقرب سكربت ممكن، قبل تحميل Tailwind/SDK ──
  {
    const tagIdx = headSrc.indexOf('classList.add("auth-pending")');
    const tailwindIdx = headSrc.indexOf("cdn.tailwindcss.com");
    assert(tagIdx !== -1, "dashboard-head.html يضيف وسم auth-pending على <html>");
    assert(tagIdx !== -1 && tailwindIdx !== -1 && tagIdx < tailwindIdx,
      "وسم auth-pending يُضاف قبل تحميل Tailwind — أقرب ما يمكن لأول رسم");
  }

  // ── CSS يخفي body فعلياً طالما الوسم موجود (visibility لا display) ──
  {
    assert(
      /html\.auth-pending\s+body\s*\{[^}]*visibility:\s*hidden/.test(headSrc),
      "CSS: html.auth-pending body { visibility: hidden } موجودة"
    );
  }

  // ── main.js يعرّف revealDashboard ويزيل الوسم بها فقط ──
  {
    assert(/function revealDashboard\(\)/.test(mainSrc), "main.js يعرّف revealDashboard()");
    assert(/revealDashboard\(\)\s*\{\s*document\.documentElement\.classList\.remove\("auth-pending"\)/.test(mainSrc),
      "revealDashboard يزيل بالضبط وسم auth-pending");
  }

  // ── مسار "زيارة مباشرة بلا جلسة": redirect لـ/login بلا أي كشف للوسم ──
  {
    const startIdx = mainSrc.indexOf("if (!data?.loggedIn) {");
    const endIdx = mainSrc.indexOf("// مسجَّل فعلاً", startIdx);
    assert(startIdx !== -1 && endIdx !== -1 && startIdx < endIdx, "عُثر على كتلة data.loggedIn === false بـmain.js");
    const block = mainSrc.slice(startIdx, endIdx);
    assert(!block.includes("revealDashboard("), "لا نداء revealDashboard() داخل مسار غير مسجَّل — اللوحة تبقى مخفية حتى يبتعد المتصفح");
    assert(block.includes('window.location.href = "/login"'), "الزائر المباشر غير المسجَّل يُحوَّل لـ/login");
  }

  // ── مسار "مسجَّل فعلاً": revealDashboard() يُستدعى قبل ملء أي بيانات هوية ──
  {
    const revealIdx = mainSrc.indexOf("// مسجَّل فعلاً");
    const callIdx = mainSrc.indexOf("revealDashboard();", revealIdx);
    const identityIdx = mainSrc.indexOf("navStoreTitle");
    assert(revealIdx !== -1 && callIdx !== -1 && identityIdx !== -1 && callIdx < identityIdx,
      "revealDashboard() يُستدعى فور تأكيد تسجيل الدخول، قبل ملء عناصر الهوية"
    );
  }

  // ── مسار سلة المضمّن: فشل تأسيس الجلسة يكشف الوسم قبل إظهار toast الخطأ ──
  {
    const failIdx = mainSrc.indexOf("if (!sallaSessionOk)");
    const revealInFail = mainSrc.indexOf("revealDashboard();", failIdx);
    const toastInFail = mainSrc.indexOf("window.showToast(", failIdx);
    assert(
      failIdx !== -1 && revealInFail !== -1 && toastInFail !== -1 && revealInFail < toastInFail,
      "فشل الجلسة داخل إطار سلة: revealDashboard() قبل showToast — وإلا كانت الرسالة غير مرئية"
    );
  }

  // ── مسار سلة المضمّن: عدم تسجيل الدخول (loggedIn:false) يُغلق بصمت بلا كشف ──
  {
    const idx = mainSrc.indexOf('if (inSallaFrame) { window.salla?.embedded?.destroy?.(); return; }');
    assert(idx !== -1, "مسار إطار سلة + عدم تسجيل دخول: destroy بلا تحويل");
  }

  // ── الصفحة المركَّبة فعلياً (dist) تحمل الوسم والـCSS معاً ──
  {
    assert(dash.includes('classList.add("auth-pending")'), "dist/dashboard.html المركَّب يحمل سكربت الوسم");
    assert(/html\.auth-pending\s+body/.test(dash), "dist/dashboard.html المركَّب يحمل قاعدة CSS المقابلة");
  }
}

main().then(done);

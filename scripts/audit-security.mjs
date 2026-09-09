#!/usr/bin/env node
/**
 * حراس الارتداد الأمنية (docs/SECURITY_PLAN.md §٦ — ح٢ · ح٥ · ح٦ · ح٧ · ح٨).
 * ملف واحد بخمسة فحوص بدل خمسة ملفات: نفس نمط scripts/audit-isolation.mjs،
 * مربوط بـ`npm test`. كل حارس يمنع عودة فجوة أُغلقت — لا يكتشف فجوات جديدة.
 *
 *  ح٢ audit-client-ip     : أي ذكر لـ`x-forwarded-for` خارج core/rateLimit.js (P57)
 *  ح٥ audit-csp           : 'unsafe-eval' أو مضيف خارج قائمة السماح بـscript-src/connect-src
 *                           في _headers أو core/security.js (P54/P56)
 *  ح٦ audit-store-gates   : resolveStoreId بملف تاجر/AI بلا تعليق `store-gate-ok: <سبب>` (P48)
 *  ح٧ audit-html-sinks    : innerHTML مع قالب `${...}` غير ملفوف بـesc(/escHtml( بأي *.html (P43/P47)
 *  ح٨ audit-postmessage   : event.origin مع endsWith/includes/indexOf بدل مطابقة تامة (P55)
 *
 * خروج غير صفري = ارتداد → يفشل npm test.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const failures = [];
const fail = (guard, file, detail) => failures.push(`${guard} ${file}: ${detail}`);

function walk(dir, ext, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === "archive") continue;
      walk(p, ext, out);
    } else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}
const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");
const fnFiles = walk(join(ROOT, "functions"), ".js");

// ── ح٢ ──────────────────────────────────────────────────────────────────────
for (const f of fnFiles) {
  if (rel(f) === "functions/_lib/core/rateLimit.js") continue;
  if (readFileSync(f, "utf8").includes("x-forwarded-for")) fail("ح٢", rel(f), "x-forwarded-for مذكور — استخدم clientIp() (P57)");
}

// ── ح٥ ──────────────────────────────────────────────────────────────────────
const ALLOWED_HOSTS = new Set([
  "'self'", "'unsafe-inline'", "data:", "blob:", "https:",
  "https://cdn.tailwindcss.com", "https://fonts.cdnfonts.com", "https://cdnjs.cloudflare.com",
  "https://accounts.google.com", "https://connect.facebook.net", "https://unpkg.com",
  "https://fonts.googleapis.com", "https://fonts.gstatic.com",
  "https://graph.facebook.com", "https://www.facebook.com", "https://web.facebook.com",
  "https://challenges.cloudflare.com", "https://s.salla.sa", "https://*.salla.sa"
]);
function checkCsp(file, csp) {
  if (csp.includes("'unsafe-eval'")) fail("ح٥", file, "'unsafe-eval' موجود بالـCSP (P56)");
  for (const directive of ["script-src", "connect-src"]) {
    const m = csp.match(new RegExp(`${directive}\\s+([^;]+)`));
    if (!m) continue;
    for (const src of m[1].trim().split(/\s+/)) {
      if (!ALLOWED_HOSTS.has(src)) fail("ح٥", file, `${directive} يحوي مضيفاً خارج قائمة السماح: ${src} (P54)`);
    }
  }
}
for (const line of readFileSync(join(ROOT, "_headers"), "utf8").split("\n")) {
  if (/^\s*Content-Security-Policy:/.test(line)) checkCsp("_headers", line);
}
{
  const sec = readFileSync(join(ROOT, "functions/_lib/core/security.js"), "utf8");
  const m = sec.match(/"Content-Security-Policy":\s*"([^"]+)"/);
  if (m) checkCsp("functions/_lib/core/security.js", m[1]);
  else fail("ح٥", "functions/_lib/core/security.js", "لم يُعثر على Content-Security-Policy");
}

// ── ح٦ ──────────────────────────────────────────────────────────────────────
for (const f of fnFiles) {
  const r = rel(f);
  const isStoreOrAi = r.startsWith("functions/api/store/") || /^functions\/api\/(copy|chat|image|usage)\.js$/.test(r);
  if (!isStoreOrAi) continue;
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!/\bresolveStoreId\(/.test(line) || /^\s*\/\//.test(line) || /^\s*\*/.test(line) || /import /.test(line)) return;
    const prev = lines[i - 1] || "";
    if (!/store-gate-ok:\s*\S/.test(prev)) fail("ح٦", `${r}:${i + 1}`, "resolveStoreId بلا تعليق `// store-gate-ok: <سبب>` — المطلوب resolveMerchantStoreId أو تبرير (P48)");
  });
}

// ── ح٧ ──────────────────────────────────────────────────────────────────────
const htmlFiles = readdirSync(ROOT).filter((n) => n.endsWith(".html")).map((n) => join(ROOT, n));
// بعد تقسيم dashboard.html/admin.html (docs/ARCHITECTURE.md، 2026-09-09)، كل
// innerHTML انتقل من *.html بالجذر إلى partials/**/*.html وpublic/js/**/*.js —
// النطاق القديم (جذر فقط) صار يفحص قوالب فارغة ويُفوّت الثغرة الحقيقية.
const partialsDir = join(ROOT, "partials");
const publicJsDir = join(ROOT, "public", "js");
const ch7Files = [
  ...htmlFiles,
  ...(existsSyncSafe(partialsDir) ? walk(partialsDir, ".html") : []),
  ...(existsSyncSafe(publicJsDir) ? walk(publicJsDir, ".js") : [])
];
function existsSyncSafe(p) {
  try { statSync(p); return true; } catch { return false; }
}
for (const f of ch7Files) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!/innerHTML\s*(\+=|=)/.test(line)) return;
    // كل `${expr}` بالسطر لازم يكون داخل esc(/escHtml( — أو رقم/ثابت أو نتيجة map ملفوفة سلفاً.
    const exprs = [...line.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim());
    for (const e of exprs) {
      if (/^(esc|escHtml)\(/.test(e)) continue;
      if (/^\d+$/.test(e)) continue;
      if (/^(catalogCard|reviewCard)\(/.test(e)) continue;
      if (/\.map\(.*=>.*(esc|escHtml)\(/.test(e) || /\.join\(/.test(e)) continue;
      fail("ح٧", `${rel(f)}:${i + 1}`, `innerHTML بقيمة غير مهرَّبة: \${${e.slice(0, 40)}} (P43/P47)`);
    }
  });
}

// ── ح٨ ──────────────────────────────────────────────────────────────────────
// ح٨ يشمل الوحدات الجديدة أيضاً — مستمع postMessage انتقل إلى public/js/dashboard/whatsapp.js.
for (const f of [...ch7Files, join(ROOT, "widget.js")]) {
  try {
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/event\.origin/.test(line) && /(endsWith|includes|indexOf|startsWith)\(/.test(line) && !/ORIGINS\.includes\(event\.origin\)|ALLOWED.*\.includes\(event\.origin\)/.test(line)) {
        fail("ح٨", `${rel(f)}:${i + 1}`, "event.origin بمطابقة جزئية — المطلوب قائمة أصول بمطابقة تامة (P55)");
      }
    });
  } catch { /* widget.js may not exist */ }
}

if (failures.length) {
  console.error("✖ تدقيق الأمن: ارتداد مكتشف —");
  for (const x of failures) console.error("  " + x);
  process.exit(1);
}
console.log("✔ تدقيق الأمن: ح٢ ح٥ ح٦ ح٧ ح٨ سليمة.");

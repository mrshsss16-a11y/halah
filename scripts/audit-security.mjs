#!/usr/bin/env node
/**
 * حراس الارتداد الأمنية (docs/SECURITY_PLAN.md §٦ — ح٢ · ح٥ · ح٦ · ح٧ · ح٨ · ح٩).
 * ملف واحد بستة فحوص بدل ستة ملفات: نفس نمط scripts/audit-isolation.mjs،
 * مربوط بـ`npm test`. كل حارس يمنع عودة فجوة أُغلقت — لا يكتشف فجوات جديدة.
 *
 *  ح٢ audit-client-ip     : أي ذكر لـ`x-forwarded-for` خارج core/rateLimit.js (P57)
 *  ح٥ audit-csp           : 'unsafe-eval' أو مضيف خارج قائمة السماح بـscript-src/connect-src
 *                           في _headers أو core/security.js (P54/P56)
 *  ح٦ audit-store-gates   : resolveStoreId بملف تاجر/AI بلا تعليق `store-gate-ok: <سبب>` (P48)
 *  ح٧ audit-html-sinks    : innerHTML مع قالب `${...}` غير ملفوف بـesc(/escHtml( بأي *.html (P43/P47)
 *  ح٨ audit-postmessage   : event.origin مع endsWith/includes/indexOf بدل مطابقة تامة (P55)
 *  ح١١ audit-log-sinks    : console.error/warn/log بقيمة ديناميكية خارج core/errorLog.js (LOG-1)
 *  ح١٢ audit-nul-bytes    : بايت NUL خام بأي ملف تحت functions/**
 *  ح٩ audit-secret-columns: عمود D1 اسمه *_token أو *_secret يُكتب بقيمة لم تمرّ
 *                           بـencryptSecret (core/crypto.js) بأي ملف تحت functions/**
 *
 * خروج غير صفري = ارتداد → يفشل npm test.
 * متغير بيئة للاختبار: AUDIT_SECRET_DIR (شجرة وهمية لـح٩ — tests/unit/guards.test.mjs).
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
  "https://cdn.tailwindcss.com", "https://cdnjs.cloudflare.com",
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

// ── ح٩ ──────────────────────────────────────────────────────────────────────
// لماذا: توكنات واتساب وإنستغرام كانت تُكتب بـD1 **نصاً صريحاً** بينما توكنات
// سلة مشفَّرة بنفس المستودع (`encryptSecret`) — تسريب نسخة D1 واحدة كان يسلّم
// خط واتساب كل تاجر وحساب إنستغرامه. القاعدة الآن آلية: كل `?` يملأ عموداً
// اسمه *_token أو *_secret داخل INSERT/UPDATE لازم تكون قيمته مرّت بـ
// `encryptSecret`. الاستثناء الوحيد تعليق `secret-plaintext-ok: <سبب>` فوق
// الجملة أو داخلها (عمود ليس بيانات اعتماد — مفتاح بحث أو قيمة مجزَّأة).
const SECRET_COL = /(_token|_secret)$/i;
const SECRET_MARKER = /secret-plaintext-ok:\s*\S/;

/** يقسّم على الفواصل العليا فقط (خارج الأقواس وعلامات الاقتباس) مع الإزاحة. */
function splitTop(s) {
  const out = [];
  let depth = 0, quote = null, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote && s[i - 1] !== "\\") quote = null; continue; }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) { out.push({ text: s.slice(start, i), start }); start = i + 1; }
  }
  out.push({ text: s.slice(start), start });
  return out;
}

/** فهرس القوس المُغلِق المقابل لقوس فُتح قبل `from` مباشرة (-1 لو ناقص). */
function closeParen(s, from) {
  let depth = 1, quote = null;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote && s[i - 1] !== "\\") quote = null; continue; }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}

/**
 * لكل `?` يملأ عموداً سرّياً بجملة SQL: ترتيبه بين كل علامات `?` بالجملة (وهو
 * بالضبط ترتيب وسيطه بـ`.bind(...)`) واسم العمود. يغطي INSERT ... VALUES
 * وكل `SET col = ?` (بما فيها `ON CONFLICT ... DO UPDATE SET`؛ قيم
 * `excluded.col` بلا `?` فلا تُحتسب — التشفير حصل بالـVALUES أصلاً).
 */
function secretSlots(sql) {
  const qAt = [];
  for (let i = 0; i < sql.length; i++) if (sql[i] === "?") qAt.push(i);
  const slotOf = (pos) => qAt.indexOf(pos);
  const slots = [];

  const ins = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+[\w."`]+\s*\(/i.exec(sql);
  if (ins) {
    const colsStart = ins.index + ins[0].length;
    const colsEnd = closeParen(sql, colsStart);
    const vm = colsEnd > 0 ? /VALUES\s*\(/i.exec(sql.slice(colsEnd)) : null;
    if (vm) {
      const cols = splitTop(sql.slice(colsStart, colsEnd)).map((p) => p.text.trim().replace(/["`]/g, ""));
      const valsStart = colsEnd + vm.index + vm[0].length;
      const valsEnd = closeParen(sql, valsStart);
      splitTop(sql.slice(valsStart, valsEnd < 0 ? sql.length : valsEnd)).forEach((p, i) => {
        if (p.text.trim() !== "?") return;
        if (cols[i] && SECRET_COL.test(cols[i])) {
          slots.push({ slot: slotOf(valsStart + p.start + p.text.indexOf("?")), col: cols[i] });
        }
      });
    }
  }

  const setRe = /\bSET\b([\s\S]*?)(?=\bWHERE\b|\bRETURNING\b|$)/gi;
  let m;
  while ((m = setRe.exec(sql))) {
    const bodyStart = m.index + (m[0].length - m[1].length);
    for (const p of splitTop(m[1])) {
      const eq = p.text.indexOf("=");
      if (eq < 0) continue;
      const col = p.text.slice(0, eq).trim().replace(/["`]/g, "").replace(/^[\w]+\./, "");
      const val = p.text.slice(eq + 1);
      if (!SECRET_COL.test(col) || val.trim() !== "?") continue;
      slots.push({ slot: slotOf(bodyStart + p.start + eq + 1 + val.indexOf("?")), col });
    }
  }
  return slots;
}

/** القيمة مشفَّرة: نداء مباشر لـencryptSecret، أو متغيّر أُسند من ندائه. */
function isEncryptedArg(arg, src) {
  if (/encryptSecret\s*\(/.test(arg)) return true;
  if (!/^[A-Za-z_$][\w$]*$/.test(arg)) return false;
  return new RegExp(`\\b(?:const|let|var)\\s+${arg}\\s*=\\s*await\\s+encryptSecret\\s*\\(`).test(src);
}

const secretFiles = process.env.AUDIT_SECRET_DIR
  ? walk(join(ROOT, process.env.AUDIT_SECRET_DIR), ".js")
  : fnFiles;

for (const f of secretFiles) {
  const src = readFileSync(f, "utf8");
  let i = -1;
  while ((i = src.indexOf(".bind(", i + 1)) !== -1) {
    const pIdx = src.lastIndexOf("prepare(", i);
    const sqlEnd = src.lastIndexOf(")", i);
    if (pIdx === -1 || sqlEnd <= pIdx) continue;
    const slots = secretSlots(src.slice(pIdx + "prepare(".length, sqlEnd));
    if (!slots.length) continue;
    const argsStart = i + ".bind(".length;
    const argsEnd = closeParen(src, argsStart);
    if (argsEnd === -1) continue;
    // التبرير يُقبل داخل الجملة أو بالأسطر الستة فوقها (موضع تعليق الدالة).
    const region = src.slice(0, pIdx).split("\n").slice(-6).join("\n") + src.slice(pIdx, argsEnd);
    if (SECRET_MARKER.test(region)) continue;
    const args = splitTop(src.slice(argsStart, argsEnd)).map((p) => p.text.trim());
    const line = src.slice(0, i).split("\n").length;
    for (const { slot, col } of slots) {
      const arg = args[slot] ?? "";
      if (isEncryptedArg(arg, src)) continue;
      fail("ح٩", `${rel(f)}:${line}`, `عمود \`${col}\` يُكتب بقيمة لم تمرّ بـencryptSecret (\`${arg.slice(0, 40)}\`) — شفّرها بـcore/crypto.js أو برّر بتعليق \`secret-plaintext-ok: <سبب>\``);
    }
  }
}

// ── ح١٠ ─────────────────────────────────────────────────────────────────────
// لماذا: ذاكرة المتجهات تحمل **نص التاجر الخام** بـmetadata. نداء مباشر على
// `env.VECTORIZE_INDEX` من أي ملف يعني: (أ) استعلام قد ينسى `filter.storeId`
// فيقرأ ذاكرة تاجر آخر، (ب) كتابة بلا صف بـ`vector_refs` فيصير النص غير قابل
// للحذف ووعد «الحذف نهائي» كاذباً. المالك الوحيد `ai/vectorStore.js` يفرض
// الاثنين. فحص وجود الربط (`env?.VECTORIZE_INDEX ? ... : ...`) ليس نداءً ويمرّ.
const VECTOR_OWNER = "functions/_lib/ai/vectorStore.js";
const VECTOR_CALL = /VECTORIZE_INDEX\s*\.\s*(query|upsert|insert|deleteByIds|getByIds)\s*\(/;
for (const f of fnFiles) {
  const r = rel(f);
  if (r === VECTOR_OWNER) continue;
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    const m = VECTOR_CALL.exec(line);
    if (m) fail("ح١٠", `${r}:${i + 1}`, `نداء VECTORIZE_INDEX.${m[1]}( خارج ${VECTOR_OWNER} — العزل بـstoreId وسجل vector_refs يعيشان هناك وحدهما`);
  });
}

// ── ح١١ ─────────────────────────────────────────────────────────────────────
// LOG-1 — لماذا: `console.error/warn/log` بقيمة متغيّرة تحت functions/** تسكب
// رسائل مزوّدين ونصوص طلبات في مجرى سجل Cloudflare بلا تنقية: رسالة خطأ من
// Graph API قد تحمل التوكن المرفوض، و`err.stack` قد يحمل ترويسة Authorization.
// المسار الوحيد المسموح هو `core/errorLog.js` (يطبّق sanitizeInternal ثم يكتب).
// نداء بوسائط كلها سلاسل حرفية ثابتة يمرّ (لا شيء ديناميكي ليُسرَّب).
// الاستثناء المبرَّر: تعليق `// log-ok: <سبب>` بنفس السطر أو السطر السابق —
// يُستعمل حين تكون القيمة منقّاة سلفاً بـsanitizeInternal ولا نريد صف D1 لكل
// سقوط طبقة متوقع (ai/gateway.js). النطاق functions/** فقط: scripts/ وcron
// خارج مسار الطلب ولا يريان بيانات تاجر. (2026-09-17)
const LOG_OWNER = "functions/_lib/core/errorLog.js";
const LOG_CALL = /console\s*\.\s*(error|warn|log|info|debug)\s*\(/;
const LOG_MARKER = /log-ok:\s*\S/;
/** يزيل السلاسل الحرفية؛ ما يتبقّى فيه حرف كلمة = وسيط ديناميكي. */
function hasDynamicArg(args) {
  const stripped = args
    .replace(/`[^`]*`/g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, "")
    .replace(/'(?:[^'\\]|\\.)*'/g, "");
  return /[\w$]/.test(stripped);
}
const logFiles = process.env.AUDIT_LOG_DIR ? walk(join(ROOT, process.env.AUDIT_LOG_DIR), ".js") : fnFiles;
for (const f of logFiles) {
  const r = rel(f);
  if (r.endsWith("core/errorLog.js") || r === LOG_OWNER) continue;
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const m = LOG_CALL.exec(line);
    if (!m) return;
    if (LOG_MARKER.test(line) || LOG_MARKER.test(lines[i - 1] || "")) return;
    const argsStart = m.index + m[0].length;
    const end = closeParen(line, argsStart);
    const args = line.slice(argsStart, end < 0 ? line.length : end);
    if (!hasDynamicArg(args)) return;
    fail("ح١١", `${r}:${i + 1}`, `console.${m[1]}( بقيمة ديناميكية — مرّرها بـlogError (core/errorLog.js) أو برّر بتعليق \`// log-ok: <سبب>\` (LOG-1)`);
  });
}

// ── ح١٢ ─────────────────────────────────────────────────────────────────────
// بايت NUL خام داخل ملف مصدر: يجعل الملف «binary» لكل أداة نصية (grep، diff،
// مراجعة الفروقات) فيختفي من التدقيق. المكافئ النصي `\u0000` ينتج نفس البايتات
// عند الترميز فلا يتغيّر أي مفتاح كاش. (2026-09-17)
for (const f of logFiles) {
  if (readFileSync(f).includes(0)) {
    fail("ح١٢", rel(f), "بايت NUL خام بملف مصدر — استبدله بالتهريب `\\u0000` (نفس البايتات، ملف نصي)");
  }
}

if (failures.length) {
  console.error("✖ تدقيق الأمن: ارتداد مكتشف —");
  for (const x of failures) console.error("  " + x);
  process.exit(1);
}
console.log("✔ تدقيق الأمن: ح٢ ح٥ ح٦ ح٧ ح٨ ح٩ ح١٠ ح١١ ح١٢ سليمة.");

#!/usr/bin/env node
/**
 * حارس التصديرات الميتة (docs/ARCHITECTURE.md §٤، المرحلة ١).
 *
 * لماذا: التدقيق المعماري (2026-09-09) رصد ٣٥ تصديراً بلا مستورد داخل
 * `functions/_lib/**`. التصدير الميت ليس مجرد سطر زائد — هو سطح تعديل زائف
 * يضلّل أي وكيل/مطور لاحق («هذه واجهة عامة، انتبه لكسرها») بينما لا أحد يستدعيها،
 * ويضخّم الملفات فوق سقوفها. الحارس يمنع عودة النمو.
 *
 * الطريقة (فحص نصي، لا AST — كافٍ لحجم المشروع وبلا تبعيات):
 *  ١. لكل ملف بـ`functions/_lib/**`: استخرج أسماء التصديرات
 *     (`export function|const|let|class|async function` و `export { a, b as c }`).
 *  ٢. امسح `functions/**` و`cron-worker/**` و`tests/**` و`scripts/**` بحثاً عن
 *     استخدام فعلي: اسم داخل `import { ... }`، أو `import * as ns` (فيُعد الملف
 *     كله مستخدَماً)، أو `export { x } from "..."` (إعادة تصدير = مستورد).
 *  ٣. تصدير بلا أي مستورد = فشل.
 *
 * الاستثناءات (ALLOWLIST): كل سطر بتاريخ + سبب + مرحلة الإزالة. والحارس يفشل
 * أيضاً لو **زاد** عدد الاستثناءات عن `EXPECTED_ALLOWLIST` — الرقم يتقلّص كل مرحلة
 * ولا يكبر أبداً (قاعدة القائمة البيضاء، ARCHITECTURE.md §٤).
 *
 * تشغيل: node scripts/audit-dead-exports.mjs  (ضمن npm test)
 * متغير بيئة اختياري للاختبار: AUDIT_LIB_DIR / AUDIT_SCAN_DIRS (يُستخدم بـtests/guards.test.mjs).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

// ── قائمة السماح ────────────────────────────────────────────────────────────
// الشكل: "مسار:اسم" → سبب. كل سطر: تاريخ + سبب + مرحلة الإزالة.
const ALLOWLIST = new Map([
  // 2026-09-09 · عقد المحوّل (integrations = isConfigured/receive/send، ARCHITECTURE.md §١).
  // مسار إرسال إنستغرام مبني وغير موصول (AGENT.md §٣: «مبني، غير مفعَّل»).
  // الإزالة أو التوصيل: المرحلة ٦ («توصيل أو حذف مسار إرسال إنستغرام الميت»).
  ["functions/_lib/integrations/instagram.js:replyToComment", "عقد المحوّل — يوصَّل بالمرحلة ٦ (2026-09-09)"],
  ["functions/_lib/integrations/instagram.js:sendPrivateReply", "عقد المحوّل — يوصَّل بالمرحلة ٦ (2026-09-09)"],
  ["functions/_lib/integrations/instagram.js:sendDirectMessage", "عقد المحوّل — يوصَّل بالمرحلة ٦ (2026-09-09)"],
  ["functions/_lib/integrations/instagram.js:subscribeToWebhooks", "عقد المحوّل — يوصَّل بالمرحلة ٦ (2026-09-09)"],
  ["functions/_lib/integrations/instagram.js:refreshLongLivedToken", "عقد المحوّل — يوصَّل بالمرحلة ٦ (2026-09-09)"],
]);
// الحارس يفشل لو زاد العدد عن هذا الرقم. يتقلّص كل مرحلة، لا يكبر.
const EXPECTED_ALLOWLIST = 5;

const LIB_DIR = process.env.AUDIT_LIB_DIR
  ? join(ROOT, process.env.AUDIT_LIB_DIR)
  : join(ROOT, "functions/_lib");
const SCAN_DIRS = (process.env.AUDIT_SCAN_DIRS
  ? process.env.AUDIT_SCAN_DIRS.split(",")
  : ["functions", "cron-worker", "tests", "scripts"]
).map((d) => join(ROOT, d.trim()));

const SKIP_DIRS = new Set(["node_modules", "dist", "archive", ".git", "backups", "graphify-out"]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".js") || p.endsWith(".mjs")) out.push(p);
  }
  return out;
}
const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");

// ── ١. استخراج التصديرات ────────────────────────────────────────────────────
/** @type {{file:string, name:string}[]} */
const exports_ = [];
const libFiles = walk(LIB_DIR);
for (const f of libFiles) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/^\s*export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    exports_.push({ file: rel(f), name: m[1] });
  }
  for (const m of src.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const t = part.trim();
      if (!t) continue;
      const asMatch = t.match(/\bas\s+([A-Za-z_$][\w$]*)\s*$/);
      const name = asMatch ? asMatch[1] : t;
      if (/^[A-Za-z_$][\w$]*$/.test(name) && name !== "default") exports_.push({ file: rel(f), name });
    }
  }
}

// ── ٢. استخراج الاستيرادات الفعلية ──────────────────────────────────────────
const importedNames = new Set();      // كل اسم مستورد بأي مكان
const namespaceModules = new Set();   // مسارات مستوردة بـ`import * as`

const scanFiles = new Set();
for (const d of SCAN_DIRS) for (const f of walk(d)) scanFiles.add(f);

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const abs = join(fromFile, "..", spec);
  return rel(abs);
}

for (const f of scanFiles) {
  const src = readFileSync(f, "utf8");
  // import { a, b as c } from "..."   /   export { a } from "..."
  for (const m of src.matchAll(/(?:import|export)\s*\{([^{}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    for (const part of m[1].split(",")) {
      const t = part.trim();
      if (!t) continue;
      const name = t.split(/\s+as\s+/)[0].trim();
      if (name) importedNames.add(name);
    }
  }
  // export * from "..." → الملف كله معاد تصديره
  for (const m of src.matchAll(/export\s*\*\s*from\s*["']([^"']+)["']/g)) {
    const r = resolveSpec(f, m[1]);
    if (r) namespaceModules.add(r);
  }
  // استيراد ديناميكي مفكَّك: const { a, b: c } = await import("...")
  // (النمط السائد بـtests/*.test.mjs — تجاهله يُنتج «تصدير ميت» كاذباً)
  // `[^{}]` (لا `[^}]`) مقصود: بلا منع الأقواس المتداخلة يبتلع الـregex من `{`
  // كتلة `if` سابقة بعيدة فيُخطئ الأسماء. ويسمح بالأسطر الجديدة عمداً — التفكيك
  // متعدد الأسطر شائع بـtests/api.test.mjs.
  for (const m of src.matchAll(/\{([^{}]*)\}\s*=\s*(?:await\s+)?import\s*\(/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/[:=]/)[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) importedNames.add(name);
    }
  }
  // فضاء أسماء (ثابت أو ديناميكي): `import * as ig from "…"` / `const ig = await import("…")`.
  // لا نَعُدّ الملف كله مستخدَماً — نَعُدّ فقط الأعضاء المقروءة فعلاً `ig.member`،
  // وإلا صار أي ملف يلمسه اختبار واحد محصّناً من الحارس كلياً.
  const nsBindings = [
    ...src.matchAll(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s*from\s*["']([^"']+)["']/g),
    ...src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?import\s*\(\s*["']([^"']+)["']/g),
  ];
  for (const [, ns, spec] of nsBindings) {
    for (const m of src.matchAll(new RegExp(`\\b${ns}\\.([A-Za-z_$][\\w$]*)`, "g"))) importedNames.add(m[1]);
    // وصول محسوب `ns[name]` (مثل scripts/export-persona.mjs) — الاسم يُبنى وقت
    // التشغيل ولا يظهر بالنص. الوحيد الصادق هنا: اعتبار الوحدة كلها مستخدَمة،
    // لا ادّعاء تغطية لا تملكها الأداة (سيؤدي لحذف تصدير حي).
    if (new RegExp(`\\b${ns}\\[`).test(src)) {
      const r = resolveSpec(f, spec);
      if (r) namespaceModules.add(r);
    }
  }
}

// ── ٣. الحكم ────────────────────────────────────────────────────────────────
const failures = [];
const usedAllowlistKeys = new Set();

for (const { file, name } of exports_) {
  if (namespaceModules.has(file)) continue; // الملف كله مستورَد كفضاء أسماء
  if (importedNames.has(name)) continue;
  const key = `${file}:${name}`;
  if (ALLOWLIST.has(key)) { usedAllowlistKeys.add(key); continue; }
  failures.push(`تصدير ميت: ${key} — لا مستورد بأي من ${SCAN_DIRS.map(rel).join("، ")}`);
}

if (ALLOWLIST.size > EXPECTED_ALLOWLIST) {
  failures.push(`عدد الاستثناءات ${ALLOWLIST.size} > المسموح ${EXPECTED_ALLOWLIST} — قائمة السماح تتقلّص ولا تكبر.`);
}
// فحص «استثناء لم يعد لازماً» يخصّ الشجرة الحقيقية فقط — بشجرة اختبار وهمية
// (AUDIT_LIB_DIR) كل الاستثناءات ستبدو غير مستعملة، وهذا ضجيج لا معلومة.
const fixtureMode = Boolean(process.env.AUDIT_LIB_DIR || process.env.AUDIT_SCAN_DIRS);
for (const key of fixtureMode ? [] : ALLOWLIST.keys()) {
  if (!usedAllowlistKeys.has(key)) {
    const [file] = key.split(":");
    if (existsSync(join(ROOT, file))) {
      failures.push(`استثناء لم يعد لازماً (التصدير غير موجود أو صار مستخدَماً): ${key} — احذفه من ALLOWLIST.`);
    }
  }
}

if (failures.length) {
  console.error("✖ تدقيق التصديرات الميتة —");
  for (const x of failures) console.error("  " + x);
  process.exit(1);
}
console.log(`✔ تدقيق التصديرات الميتة: ${exports_.length} تصديراً مفحوصاً، ${ALLOWLIST.size} استثناءً مبرَّراً.`);

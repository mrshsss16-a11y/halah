#!/usr/bin/env node
/**
 * حارس اتجاه الطبقات (docs/ARCHITECTURE.md §١ و§٤، المرحلة ١).
 *
 * لماذا: التدقيق المعماري (2026-09-09) وجد اتجاه التبعيات **نظيفاً تماماً**
 * (صفر استيراد عكسي). هذه ميزة نادرة تُفقَد بسطر واحد ولا يلاحظها أحد — الحارس
 * يثبّتها قبل المراحل ٣ و٤ اللي راح تحرّك عشرات الملفات. مهمته منع الارتداد،
 * لا اكتشاف خرق جديد.
 *
 * القواعد المفروضة (§١):
 *   ق١  core/**          لا يستورد من domain · ai · integrations · api
 *   ق٢  integrations/**  لا يستورد core/db.js ولا domain ولا api
 *   ق٣  domain/**        لا يستورد core/respond.js
 *        (المجال يرمي DomainError ويترجمها withApi — لا يعرف HTTP)
 *   ق٤  api/**           لا يحوي `.prepare(` (SQL خام بطبقة تنسيق)
 *   ق٥  api/**           لا يبني system prompt (دالة `build*System*` أو
 *        `PERSONA_SYSTEM_PROMPT` داخل template literal)
 *   ق٦  api/**           لا يستورد integrations/** مباشرة — يمرّ بـdomain/
 *        (أُضيفت بالمرحلة ٦: النداء على محوّل خارجي قرار مجال لا تنسيق؛ وبقاؤه
 *         بـapi كان يعيد بناء منطق القناة بكل نقطة نهاية)
 *
 * قائمة سماح مؤرَّخة بـ`ملف:سطر` لكل مخالفة قائمة اليوم، وعددها `EXPECTED_ALLOWLIST`
 * يتقلّص كل مرحلة ولا يكبر. لأن الأسطر تتحرك مع أي تعديل، المفتاح `ملف#قاعدة`
 * والسطر مسجَّل كتوثيق داخل السبب لا كجزء من المطابقة — وإلا صار الحارس ضجيجاً
 * يُعطَّل بعد أول إعادة تنسيق.
 *
 * تشغيل: node scripts/audit-layering.mjs  (ضمن npm test)
 * متغير بيئة للاختبار: AUDIT_LAYER_ROOT (شجرة وهمية — tests/guards.test.mjs).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.env.AUDIT_LAYER_ROOT ? join(process.cwd(), process.env.AUDIT_LAYER_ROOT) : process.cwd();

// ── قائمة السماح ────────────────────────────────────────────────────────────
// المفتاح: "<مسار الملف>#<رقم القاعدة>" → سبب + الموضع يوم التسجيل + مرحلة الإزالة.
const ALLOWLIST = new Map([
  // 2026-09-09 · **صفر استثناء** بعد المرحلة ٦ (ARCHITECTURE.md §٣: «كل الحراس
  // بلا قوائم سماح»). ما زال هنا للتوثيق فقط، وقاعدة القائمة البيضاء (§٤) تمنع
  // إضافة أي مدخل: `EXPECTED_ALLOWLIST = 0`، وأي إضافة تفشل الحارس.
  //
  // ما سقط بالمرحلة ٦:
  //  · `core/db.js#ق١` — الملف **حُذف**. كان shim إعادة تصدير لـdomain/*؛ كل
  //    مستورديه (٢٥ ملفاً بـapi/ وtests/ وcore/session.js) صاروا يستوردون من
  //    `domain/*` مباشرة. قراءتا الهوية (`getMerchant`/`getAccountEmail`) اللتان
  //    يحتاجهما `core/session.js` انتقلتا إلى `core/identity.js` (قراءة صف
  //    بمفتاحه، صفر منطق) فلم يعد core يستورد domain إطلاقاً.
  //  · `integrations/salla.js#ق٢` — كتلة الـshim **حُذفت**. المحوّل صار HTTP
  //    خالصاً: كل دالة تأخذ توكناً جاهزاً، والمجال (`domain/salla.js` عبر
  //    `getValidSallaToken`) هو من يجلبه ويمرّره.
  // كذلك حُذف مجلد `services/*` بالكامل (خمسة shims إعادة تصدير).
]);
const EXPECTED_ALLOWLIST = 0;

const SKIP_DIRS = new Set(["node_modules", "dist", "archive", ".git", "backups", "graphify-out", ".wrangler"]);
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}
const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");

/** كل مواصفات الاستيراد بالملف (ثابتة وديناميكية)، مطبَّعة لمسار نسبي للجذر. */
function importSpecs(file, src) {
  const specs = [];
  const patterns = [
    /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const spec = m[1];
      if (!spec.startsWith(".")) continue;
      specs.push({ spec, resolved: rel(join(file, "..", spec)) });
    }
  }
  return specs;
}

const failures = [];
const hits = new Set(); // "file#rule" لكل مخالفة وُجدت فعلاً

function record(file, rule, detail) {
  const key = `${file}#${rule}`;
  hits.add(key);
  if (ALLOWLIST.has(key)) return;
  failures.push(`${rule} ${file}: ${detail}`);
}

const libFiles = walk(join(ROOT, "functions/_lib"));
const apiFiles = walk(join(ROOT, "functions/api"));

for (const f of libFiles) {
  const r = rel(f);
  const src = readFileSync(f, "utf8");
  const specs = importSpecs(f, src);
  const inCore = r.startsWith("functions/_lib/core/");
  const inIntegrations = r.startsWith("functions/_lib/integrations/");
  const inDomain = r.startsWith("functions/_lib/domain/");

  for (const { resolved } of specs) {
    // ق١ — core لا يعرف ما فوقه
    if (inCore) {
      for (const layer of ["domain", "ai", "integrations"]) {
        if (resolved.startsWith(`functions/_lib/${layer}/`)) {
          record(r, "ق١", `core يستورد ${layer}/ (${resolved}) — core بنية تحتية فقط (§١)`);
        }
      }
      if (resolved.startsWith("functions/api/")) record(r, "ق١", `core يستورد api/ (${resolved})`);
    }
    // ق٢ — المحوّل لا يعرف قاعدة البيانات ولا المجال
    if (inIntegrations) {
      if (resolved === "functions/_lib/core/db.js") {
        record(r, "ق٢", "المحوّل يستورد core/db.js — عقد المحوّل isConfigured/receive/send بصفر D1 (§١)");
      }
      if (resolved.startsWith("functions/_lib/domain/") || resolved.startsWith("functions/_lib/services/")) {
        record(r, "ق٢", `المحوّل يستورد ${resolved} — الاتجاه معكوس`);
      }
      if (resolved.startsWith("functions/api/")) record(r, "ق٢", `المحوّل يستورد api/ (${resolved})`);
    }
    // ق٣ — المجال لا يعرف HTTP
    if (inDomain && resolved === "functions/_lib/core/respond.js") {
      record(r, "ق٣", "domain يستورد core/respond.js — المجال يرمي DomainError ويترجمها withApi (§١)");
    }
  }
}

for (const f of apiFiles) {
  const r = rel(f);
  const src = readFileSync(f, "utf8");
  const lines = src.split("\n");

  // ق٦ — طبقة التنسيق لا تنادي محوّلاً خارجياً بنفسها. المجال هو من يقرر
  // «هل القناة مضبوطة؟ ماذا نرسل؟ ماذا نسجّل؟»، وapi يستدعيه ويصيغ الرد.
  for (const { resolved } of importSpecs(f, src)) {
    if (resolved.startsWith("functions/_lib/integrations/")) {
      record(r, "ق٦", `api يستورد ${resolved} مباشرة — النداء على المحوّل يعيش بـdomain/ (§١)`);
    }
  }

  let sawPrepare = false;
  let sawPrompt = null;
  lines.forEach((line, i) => {
    if (!sawPrepare && line.includes(".prepare(")) {
      sawPrepare = true;
      record(r, "ق٤", `SQL خام بطبقة التنسيق: \`.prepare(\` بالسطر ${i + 1} — انقله لـdomain/ (§١)`);
    }
    if (sawPrompt) return;
    if (/^\s*(export\s+)?(async\s+)?function\s+build\w*[Ss]ystem\w*\s*\(/.test(line)) {
      sawPrompt = true;
      record(r, "ق٥", `دالة بناء system prompt بالسطر ${i + 1} — البرومبت يُبنى بـdomain/ أو ai/ (§١)`);
    } else if (/PERSONA_SYSTEM_PROMPT/.test(line) && /[`$]/.test(line)) {
      sawPrompt = true;
      record(r, "ق٥", `تركيب PERSONA_SYSTEM_PROMPT داخل قالب نصي بالسطر ${i + 1} — البرومبت يُبنى بـdomain/ أو ai/`);
    }
  });
}

if (ALLOWLIST.size > EXPECTED_ALLOWLIST) {
  failures.push(`عدد الاستثناءات ${ALLOWLIST.size} > المسموح ${EXPECTED_ALLOWLIST} — القائمة تتقلّص ولا تكبر.`);
}
// فحص «استثناء لم يعد لازماً» يخصّ الشجرة الحقيقية فقط — بشجرة اختبار وهمية
// (AUDIT_LAYER_ROOT) الملفات مصطنعة وبلا المخالفات المسجَّلة، فكل استثناء
// سيبدو زائداً وهذا ضجيج لا معلومة. نفس نمط audit-dead-exports.mjs (fixtureMode).
const fixtureMode = Boolean(process.env.AUDIT_LAYER_ROOT);
for (const key of fixtureMode ? [] : ALLOWLIST.keys()) {
  const [file] = key.split("#");
  if (!hits.has(key) && existsSync(join(ROOT, file))) {
    failures.push(`استثناء لم يعد لازماً: ${key} — المخالفة اختفت، احذفه من ALLOWLIST وأنقص EXPECTED_ALLOWLIST.`);
  }
}

if (failures.length) {
  console.error("✖ تدقيق الطبقات —");
  for (const x of failures) console.error("  " + x);
  process.exit(1);
}
console.log(`✔ تدقيق الطبقات: ق١ ق٢ ق٣ ق٤ ق٥ ق٦ سليمة، ${ALLOWLIST.size} استثناءً مؤرَّخاً.`);

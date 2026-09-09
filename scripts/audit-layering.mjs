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
 *   ق٢  integrations/**  لا يستورد core/db.js ولا domain ولا services ولا api
 *   ق٣  domain/** و services/**  لا يستوردان core/respond.js
 *        (المجال يرمي DomainError ويترجمها withApi — لا يعرف HTTP)
 *   ق٤  api/**           لا يحوي `.prepare(` (SQL خام بطبقة تنسيق)
 *   ق٥  api/**           لا يبني system prompt (دالة `build*System*` أو
 *        `PERSONA_SYSTEM_PROMPT` داخل template literal)
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
  // 2026-09-09 (أُنجز بالمرحلة ٣) · اقتران المحوّل بـ`core/db.js` **زال**: التوكن
  // والتشفير وقفل التجديد صاروا بـ`domain/salla.js`، والمحوّل HTTP خالص.
  // ما بقي: كتلة shim بآخر الملف تحفظ توقيع `(env, merchantId, …)` لمستوردي
  // `api/**` الأربعة (store/overview · store/publish · store/review/decide ·
  // webhooks/salla) — تعديل `api/**` خارج نطاق المرحلة ٣ عمداً (القاعدة الذهبية:
  // صفر تعديل على المستوردين). الكتلة تستورد `domain/salla.js` فتقع تحت ق٢.
  // الإزالة: **المرحلة ٤** (إفراغ `api/*`) — عندها يعود الملف HTTP خالصاً تماماً.
  ["functions/_lib/integrations/salla.js#ق٢", "shim توقيعات لمستوردي api الأربعة يستورد domain/salla.js — يُحذف بالمرحلة ٤"],

  // 2026-09-09 (جديد بالمرحلة ٣) · `core/db.js` صار **shim إعادة تصدير** فقط
  // (كان ١٣٥٠ سطراً و٨٤ تصديراً). يعيد تصدير `domain/*` حتى لا يتغيّر أي من
  // الأربعين مستورداً بهذه المرحلة، فيستورد core من domain (خرق ق١ بالشكل، لا
  // بالمضمون: صفر منطق). الإزالة: **المرحلة ٦** («إزالة shim db.js»).
  ["functions/_lib/core/db.js#ق١", "shim إعادة تصدير مؤقت لـdomain/* — يُزال بالمرحلة ٦"],

  // 2026-09-09 · ق٤ — `.prepare(` بطبقة التنسيق. §٣ المرحلة ٤: «إفراغ api/*».
  // الموضع المسجَّل = أول `.prepare(` يوم التسجيل (توثيق، ليس جزءاً من المطابقة).
  ["functions/api/admin/errors.js#ق٤", "SQL خام (سطر ٢٩) — المرحلة ٤"],
  ["functions/api/auth/complete_account.js#ق٤", "SQL خام (سطر ٧٢) — المرحلة ٤"],
  ["functions/api/auth/forgot_password.js#ق٤", "SQL خام (سطر ٥١) — المرحلة ٤"],
  ["functions/api/auth/google.js#ق٤", "SQL خام (سطر ١٦٣) — المرحلة ٤"],
  ["functions/api/auth/login.js#ق٤", "SQL خام (سطر ٦٤) — المرحلة ٤"],
  ["functions/api/auth/me.js#ق٤", "SQL خام (سطر ٢٣) — المرحلة ٤"],
  ["functions/api/auth/reset_password.js#ق٤", "SQL خام (سطر ٧٦) — المرحلة ٤"],
  ["functions/api/auth/send_verification.js#ق٤", "SQL خام (سطر ٣٧) — المرحلة ٤"],
  ["functions/api/auth/signup.js#ق٤", "SQL خام (سطر ١١٦) — المرحلة ٤"],
  ["functions/api/auth/verify_email.js#ق٤", "SQL خام (سطر ٢٦) — المرحلة ٤"],
  ["functions/api/chat.js#ق٤", "SQL خام (سطر ٣٨) — المرحلة ٤"],
  ["functions/api/cron/healthcheck.js#ق٤", "SQL خام (سطر ٤٢) — المرحلة ٤"],
  ["functions/api/cron/reminders.js#ق٤", "SQL خام (سطر ١٠٧) — المرحلة ٤"],
  ["functions/api/health.js#ق٤", "SQL خام (سطر ٢٩) — المرحلة ٤"],
  ["functions/api/stats.js#ق٤", "SQL خام (سطر ١١) — المرحلة ٤"],
  ["functions/api/store/bulk/generate.js#ق٤", "SQL خام (سطر ٧٥) — المرحلة ٤"],
  ["functions/api/store/bulk/status.js#ق٤", "SQL خام (سطر ١٦) — المرحلة ٤"],
  ["functions/api/store/overview.js#ق٤", "SQL خام (سطر ٨٨) — المرحلة ٤"],
  ["functions/api/webhooks/salla.js#ق٤", "SQL خام (سطر ١٠١) — المرحلة ٤"],

  // 2026-09-09 · ق٥ — بناء system prompt بطبقة التنسيق. §٢: `chat.js` → domain/conversation،
  // `copy.js` → domain/copy (المرحلة ٤) · `whatsapp/webhook.js` → domain/whatsapp (المرحلة ٦).
  ["functions/api/chat.js#ق٥", "بناء system prompt (سطر ٥٠) — يُنقل لـdomain/conversation.js بالمرحلة ٤"],
  ["functions/api/copy.js#ق٥", "بناء system prompt (سطر ٢٠٧) — يُنقل لـdomain/copy.js بالمرحلة ٤"],
  ["functions/api/whatsapp/webhook.js#ق٥", "PERSONA_SYSTEM_PROMPT بقالب نصي (سطر ٢٢٩) — يُنقل لـdomain/whatsapp.js بالمرحلة ٦"],
]);
const EXPECTED_ALLOWLIST = 24;

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
  const inDomain = r.startsWith("functions/_lib/domain/") || r.startsWith("functions/_lib/services/");

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
      record(r, "ق٣", "domain/services يستورد core/respond.js — المجال يرمي DomainError ويترجمها withApi (§١)");
    }
  }
}

for (const f of apiFiles) {
  const r = rel(f);
  const lines = readFileSync(f, "utf8").split("\n");
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
console.log(`✔ تدقيق الطبقات: ق١ ق٢ ق٣ ق٤ ق٥ سليمة، ${ALLOWLIST.size} استثناءً مؤرَّخاً.`);

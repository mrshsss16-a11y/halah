// اختبار الحراس الآلية (docs/ARCHITECTURE.md §٤، المرحلة ١).
//
// لماذا هذا الملف: حارس لا يُختبَر = ثقة زائفة. سكربت يمرّ دائماً — لأن نمطه
// لا يطابق شيئاً، أو لأن مساره خطأ — يقول «✔ سليم» كل مرة ويقنع الجميع أن
// القاعدة مفروضة بينما لا شيء يفرضها. هذا أخطر من غياب الأداة (قاعدة الصدق،
// AGENT.md §١١).
//
// لكل حارس تأكيدان:
//   (أ) يمرّ على الشجرة الحقيقية اليوم (بقوائم السماح المؤرَّخة).
//   (ب) **يمسك** مخالفة مصطنعة تُكتب بشجرة وهمية مؤقتة تحت `.tmp-guard-fixture/`
//       تُمرَّر عبر متغيرات البيئة التي يقبلها كل سكربت (AUDIT_*_ROOT/DIR).
//
// التأكيد (ب) هو الأهم: بلا مخالفة مصطنعة نختبر «أن السكربت لا ينهار»، لا «أنه يكشف».

import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const FIXTURE = ".tmp-guard-fixture";
const FIXTURE_ABS = join(ROOT, FIXTURE);

let passed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; console.log("✅ PASS: " + name); }
  else { failures.push(name); console.log("❌ FAIL: " + name); }
}

/** يشغّل سكربت تدقيق ويُرجع {code, out}. */
function runGuard(script, env = {}) {
  const res = spawnSync(process.execPath, [join(ROOT, "scripts", script)], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { code: res.status ?? 1, out: (res.stdout || "") + (res.stderr || "") };
}

function write(relPath, content) {
  const abs = join(FIXTURE_ABS, relPath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

function resetFixture() {
  if (existsSync(FIXTURE_ABS)) rmSync(FIXTURE_ABS, { recursive: true, force: true });
  mkdirSync(FIXTURE_ABS, { recursive: true });
}

try {
  // ── ١. audit-dead-exports ────────────────────────────────────────────────
  {
    const real = runGuard("audit-dead-exports.mjs");
    assert(real.code === 0, "G1-1: audit-dead-exports يمرّ على الشجرة الحالية");

    resetFixture();
    // مكتبة وهمية بتصديرين: واحد مستورد وواحد ميت.
    write("lib/live.js", "export function usedByApi() { return 1; }\nexport const DEAD_CONST = 2;\n");
    write("caller/handler.js", `import { usedByApi } from "../lib/live.js";\nexport const onRequest = () => usedByApi();\n`);
    const bad = runGuard("audit-dead-exports.mjs", {
      AUDIT_LIB_DIR: `${FIXTURE}/lib`,
      AUDIT_SCAN_DIRS: `${FIXTURE}/caller`,
    });
    assert(bad.code === 1, "G1-2: يفشل عند وجود تصدير بلا مستورد");
    assert(bad.out.includes("DEAD_CONST"), "G1-3: يسمّي التصدير الميت بالتحديد");
    assert(!bad.out.includes("usedByApi"), "G1-4: لا يُبلّغ عن التصدير المستورَد فعلاً (لا إنذار كاذب)");

    // النمط الذي أسقط الحارس أثناء بنائه: استيراد ديناميكي مفكَّك داخل كتلة.
    resetFixture();
    write("lib/live.js", "export function dynamicOnly() { return 1; }\n");
    write("caller/handler.js", `export const onRequest = async () => {\n  if (true) {\n    const { dynamicOnly } = await import("../lib/live.js");\n    return dynamicOnly();\n  }\n};\n`);
    const dyn = runGuard("audit-dead-exports.mjs", {
      AUDIT_LIB_DIR: `${FIXTURE}/lib`,
      AUDIT_SCAN_DIRS: `${FIXTURE}/caller`,
    });
    assert(dyn.code === 0, "G1-5: الاستيراد الديناميكي المفكَّك داخل كتلة يُحتسب استخداماً (لا حذف لتصدير حي)");
  }

  // ── ٢. audit-file-size ───────────────────────────────────────────────────
  {
    const real = runGuard("audit-file-size.mjs");
    assert(real.code === 0, "G2-1: audit-file-size يمرّ على الشجرة الحالية");

    resetFixture();
    write("functions/api/fat.js", "// x\n".repeat(120));
    const bad = runGuard("audit-file-size.mjs", { AUDIT_SIZE_ROOT: FIXTURE });
    assert(bad.code === 1, "G2-2: يفشل عند ملف api يتجاوز ٨٠ سطراً");
    assert(bad.out.includes("functions/api/fat.js"), "G2-3: يسمّي الملف المتضخّم");

    resetFixture();
    write("functions/api/slim.js", "// x\n".repeat(20));
    write("functions/_lib/core/big.js", "// x\n".repeat(450));
    const lib = runGuard("audit-file-size.mjs", { AUDIT_SIZE_ROOT: FIXTURE });
    assert(lib.code === 1 && lib.out.includes("_lib/core/big.js"), "G2-4: يفشل عند ملف _lib يتجاوز ٤٠٠ سطر");
    assert(!lib.out.includes("slim.js"), "G2-5: لا يُبلّغ عن ملف تحت السقف");

    resetFixture();
    write("functions/api/slim.js", "// x\n".repeat(20));
    write("huge.html", "<!-- x -->\n".repeat(900));
    const html = runGuard("audit-file-size.mjs", { AUDIT_SIZE_ROOT: FIXTURE });
    assert(html.code === 1 && html.out.includes("huge.html"), "G2-6: يفشل عند صفحة HTML تتجاوز ٨٠٠ سطر");
  }

  // ── ٣. audit-layering ────────────────────────────────────────────────────
  {
    const real = runGuard("audit-layering.mjs");
    assert(real.code === 0, "G3-1: audit-layering يمرّ على الشجرة الحالية");

    // ق١ — core يستورد integrations
    resetFixture();
    write("functions/_lib/core/bad.js", `import { send } from "../integrations/whatsapp.js";\nexport const x = send;\n`);
    write("functions/_lib/integrations/whatsapp.js", "export const send = () => 1;\n");
    const r1 = runGuard("audit-layering.mjs", { AUDIT_LAYER_ROOT: FIXTURE });
    assert(r1.code === 1 && r1.out.includes("ق١"), "G3-2: ق١ يمسك core يستورد integrations/");

    // ق٢ — integrations يستورد core/db.js
    resetFixture();
    write("functions/_lib/core/db.js", "export const q = () => 1;\n");
    write("functions/_lib/integrations/bad.js", `import { q } from "../core/db.js";\nexport const x = q;\n`);
    const r2 = runGuard("audit-layering.mjs", { AUDIT_LAYER_ROOT: FIXTURE });
    assert(r2.code === 1 && r2.out.includes("ق٢"), "G3-3: ق٢ يمسك المحوّل يستورد core/db.js");

    // ق٣ — domain يستورد respond.js
    resetFixture();
    write("functions/_lib/core/respond.js", "export class ApiError extends Error {}\n");
    write("functions/_lib/domain/bad.js", `import { ApiError } from "../core/respond.js";\nexport const x = ApiError;\n`);
    const r3 = runGuard("audit-layering.mjs", { AUDIT_LAYER_ROOT: FIXTURE });
    assert(r3.code === 1 && r3.out.includes("ق٣"), "G3-4: ق٣ يمسك domain يستورد core/respond.js");

    // ق٤ — SQL خام بـapi
    resetFixture();
    write("functions/api/bad.js", `export const onRequest = ({ env }) => env.DB.prepare("SELECT 1").first();\n`);
    const r4 = runGuard("audit-layering.mjs", { AUDIT_LAYER_ROOT: FIXTURE });
    assert(r4.code === 1 && r4.out.includes("ق٤"), "G3-5: ق٤ يمسك `.prepare(` داخل api/");

    // ق٥ — بناء system prompt بـapi (الشكلان)
    resetFixture();
    write("functions/api/prompt_fn.js", "function buildChatSystemPrompt() { return 'x'; }\nexport const onRequest = buildChatSystemPrompt;\n");
    const r5 = runGuard("audit-layering.mjs", { AUDIT_LAYER_ROOT: FIXTURE });
    assert(r5.code === 1 && r5.out.includes("ق٥"), "G3-6: ق٥ يمسك دالة build*System* داخل api/");

    resetFixture();
    write("functions/api/prompt_tpl.js", "export const onRequest = () => `${PERSONA_SYSTEM_PROMPT}\\nextra`;\n");
    const r6 = runGuard("audit-layering.mjs", { AUDIT_LAYER_ROOT: FIXTURE });
    assert(r6.code === 1 && r6.out.includes("ق٥"), "G3-7: ق٥ يمسك PERSONA_SYSTEM_PROMPT داخل قالب نصي بـapi/");

    // لا إنذار كاذب: الاتجاه الصحيح يمرّ
    resetFixture();
    write("functions/_lib/core/db.js", "export const q = () => 1;\n");
    write("functions/_lib/domain/good.js", `import { q } from "../core/db.js";\nexport const use = q;\n`);
    write("functions/api/good.js", `import { use } from "../_lib/domain/good.js";\nexport const onRequest = use;\n`);
    const ok = runGuard("audit-layering.mjs", { AUDIT_LAYER_ROOT: FIXTURE });
    assert(ok.code === 0, "G3-8: الاتجاه الصحيح (api → domain → core) يمرّ بلا إنذار كاذب");
  }

  // ── ٤. audit-migrations ──────────────────────────────────────────────────
  {
    const real = runGuard("audit-migrations.mjs", { AUDIT_MIG_SKIP_REMOTE: "1" });
    assert(real.code === 0, "G4-1: audit-migrations يمرّ على الشجرة الحالية");

    // م١ — عمود بالكود بلا هجرة
    resetFixture();
    write("migrations/0001_init.sql", "CREATE TABLE bookings (\n  id INTEGER PRIMARY KEY,\n  merchant_id TEXT NOT NULL\n);\n");
    write("functions/api/x.js", `export const onRequest = ({ env }) => env.DB.prepare("SELECT id FROM bookings WHERE ghost_column = ?").first();\n`);
    const m1 = runGuard("audit-migrations.mjs", { AUDIT_MIG_ROOT: FIXTURE });
    assert(m1.code === 1 && m1.out.includes("ghost_column"), "G4-2: م١ يمسك عموداً مستخدَماً بلا هجرة");

    // م٢ — جدول بالمخطط لا يذكره الكود
    resetFixture();
    write("migrations/0001_init.sql", "CREATE TABLE bookings (\n  id INTEGER PRIMARY KEY\n);\nCREATE TABLE orphan_table (\n  id INTEGER PRIMARY KEY\n);\n");
    write("functions/api/x.js", `export const onRequest = ({ env }) => env.DB.prepare("SELECT id FROM bookings").first();\n`);
    const m2 = runGuard("audit-migrations.mjs", { AUDIT_MIG_ROOT: FIXTURE });
    assert(m2.code === 1 && m2.out.includes("orphan_table"), "G4-3: م٢ يمسك جدولاً بالمخطط لا يذكره الكود");

    // لا إنذار كاذب على مخطط متطابق (بما فيه ALTER TABLE ADD COLUMN)
    resetFixture();
    write("migrations/0001_init.sql", "CREATE TABLE bookings (\n  id INTEGER PRIMARY KEY,\n  merchant_id TEXT\n);\n");
    write("migrations/0002_add.sql", "ALTER TABLE bookings ADD COLUMN ticket_code TEXT;\n");
    write("functions/api/x.js", `export const onRequest = ({ env }) => env.DB.prepare("SELECT id FROM bookings WHERE ticket_code = ? AND merchant_id = ?").first();\n`);
    const m3 = runGuard("audit-migrations.mjs", { AUDIT_MIG_ROOT: FIXTURE });
    assert(m3.code === 0, "G4-4: مخطط متطابق (مع ALTER TABLE ADD COLUMN) يمرّ بلا إنذار كاذب");

    // مخطط فارغ لا يُعتبر نجاحاً
    resetFixture();
    write("migrations/.keep", "");
    write("functions/api/x.js", "export const onRequest = () => 1;\n");
    const m4 = runGuard("audit-migrations.mjs", { AUDIT_MIG_ROOT: FIXTURE });
    assert(m4.code === 1, "G4-5: صفر جداول مقروءة = فشل، لا «✔ سليم» على فحص لم يحدث");
  }

  // ── ٥. audit-security ح٩ (تشفير أعمدة الأسرار) ───────────────────────────
  // الفجوة المغلقة: توكنات القنوات كانت تُكتب نصاً صريحاً بـD1. الحارس نصّي —
  // فالمهم أن يمسك **إعادة السطر القديم**، لا أن «لا ينهار».
  {
    const real = runGuard("audit-security.mjs");
    assert(real.code === 0, "G6-1: audit-security يمرّ على الشجرة الحالية (بعد التشفير)");

    // (أ) INSERT بعمود *_token يأخذ التوكن خاماً — السطر الذي كان بالإنتاج.
    resetFixture();
    write("functions/wa.js", `export async function save(env, { merchantId, businessToken }) {
  await env.DB.prepare(
    \`INSERT INTO wa_connections (merchant_id, business_token, status)
     VALUES (?, ?, 'active')\`
  ).bind(merchantId, businessToken).run();
}
`);
    const ins = runGuard("audit-security.mjs", { AUDIT_SECRET_DIR: `${FIXTURE}/functions` });
    assert(ins.code === 1 && ins.out.includes("ح٩"), "G6-2: يفشل عند كتابة توكن خام بعمود *_token");
    assert(ins.out.includes("business_token"), "G6-3: يسمّي العمود المخالف بالتحديد");

    // (ب) UPDATE ... SET access_token = ? خاماً (مسار cron تجديد إنستغرام).
    resetFixture();
    write("functions/ig.js", `export async function refresh(env, row, accessToken) {
  await env.DB.prepare(
    \`UPDATE ig_connections SET access_token = ?, updated_at = datetime('now')
      WHERE merchant_id = ? AND ig_user_id = ?\`
  ).bind(accessToken, row.merchant_id, row.ig_user_id).run();
}
`);
    const upd = runGuard("audit-security.mjs", { AUDIT_SECRET_DIR: `${FIXTURE}/functions` });
    assert(upd.code === 1 && upd.out.includes("access_token"), "G6-4: يفشل عند UPDATE يعيد كتابة توكن خام");

    // (ج) لا إنذار كاذب: قيمة مرّت بـencryptSecret، وعمود مبرَّر بتعليق.
    resetFixture();
    write("functions/ok.js", `export async function save(env, { merchantId, businessToken, sessionToken }) {
  const encToken = await encryptSecret(env, businessToken);
  await env.DB.prepare(
    \`INSERT INTO wa_connections (merchant_id, business_token) VALUES (?, ?)\`
  ).bind(merchantId, encToken).run();
  // secret-plaintext-ok: مفتاح بحث لا بيانات اعتماد.
  await env.DB.prepare(
    \`INSERT INTO omnichannel_sessions (session_token, merchant_id) VALUES (?, ?)\`
  ).bind(sessionToken, merchantId).run();
}
`);
    const ok = runGuard("audit-security.mjs", { AUDIT_SECRET_DIR: `${FIXTURE}/functions` });
    assert(ok.code === 0, "G6-5: القيمة المشفَّرة والعمود المبرَّر يمرّان بلا إنذار كاذب");
  }

  // ── ٦. run-tests ─────────────────────────────────────────────────────────
  // لا يُشغَّل عودياً (سيُعيد تشغيل نفسه)؛ نتحقق من العقد نصياً: يجمع عودياً،
  // لا يتوقف عند أول فشل، ويرجع exit 1.
  {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(join(ROOT, "scripts/run-tests.mjs"), "utf8");
    assert(/\.test\.mjs/.test(src) && /collect\(p, out\)/.test(src), "G5-1: run-tests يجمع *.test.mjs عودياً");
    assert(!/break|return/.test(src.split("for (const f of files)")[1]?.split("}")[0] || ""), "G5-2: لا توقف عند أول فشل داخل حلقة التشغيل");
    assert(/process\.exit\(1\)/.test(src), "G5-3: يرجع exit 1 عند أي فشل");
    assert(/لم يُعثر على أي ملف/.test(src), "G5-4: صفر ملفات اختبار = فشل لا نجاح صامت");
  }
} finally {
  if (existsSync(FIXTURE_ABS)) rmSync(FIXTURE_ABS, { recursive: true, force: true });
}

console.log(`\n${passed} تأكيداً ناجحاً، ${failures.length} فاشلاً.`);
if (failures.length) {
  console.error("✖ اختبار الحراس فشل:");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("✔ كل الحراس تمرّ على الشجرة الحالية وتمسك مخالفة مصطنعة.");

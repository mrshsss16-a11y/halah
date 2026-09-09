#!/usr/bin/env node
/**
 * حارس أحجام الملفات (docs/ARCHITECTURE.md §٤، المرحلة ١).
 *
 * لماذا: التشخيص المعماري (2026-09-09) وصف المرض بأنه «تضخّم غير مقسّم» —
 * `core/db.js` ١٤٨٥ سطراً بتسعة مجالات، طبقة `api/*` سميكة بمنطق أعمال،
 * `dashboard.html` ١٩٨٢ سطراً. السقف وحده لا يُصلح الموجود، لكنه يمنع الأسوأ:
 * أن يستمر النمو بينما التقسيم مؤجَّل.
 *
 * السقوف (§١ و§٤):
 *   functions/api/**   ≤ ٨٠ سطراً   (تنسيق فقط: withApi ← تحقق ← domain ← json)
 *   functions/_lib/**  ≤ ٤٠٠ سطراً
 *   *.html بالجذر      ≤ ٨٠٠ سطراً
 *
 * قاعدة القائمة البيضاء — نقطتان تجعلانها أداة تقليص لا ورقة عفو:
 *   ١. كل ملف مسموح مسجَّل **بعدد أسطره يوم التسجيل**. لو كبر عن رقمه → فشل.
 *      فالدَين القائم يُحتمل، ونموّه لا. (تقليصه لا يفشل — مطلوب ومرحَّب به.)
 *   ٢. عدد الاستثناءات محسوب بـ`EXPECTED_ALLOWLIST`؛ زيادته تفشل الحارس.
 *      الرقم يتقلّص كل مرحلة من §٣ ولا يكبر أبداً.
 *
 * تشغيل: node scripts/audit-file-size.mjs  (ضمن npm test)
 *        AUDIT_PRINT_ALLOWLIST=1 node scripts/audit-file-size.mjs  → يطبع لقطة جديدة
 * متغير بيئة للاختبار: AUDIT_SIZE_ROOT (شجرة وهمية — tests/guards.test.mjs).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.env.AUDIT_SIZE_ROOT ? join(process.cwd(), process.env.AUDIT_SIZE_ROOT) : process.cwd();

const CAPS = [
  { label: "functions/api/**", dir: "functions/api", ext: ".js", cap: 80 },
  { label: "functions/_lib/**", dir: "functions/_lib", ext: ".js", cap: 400 },
  { label: "*.html (الجذر)", dir: ".", ext: ".html", cap: 800, flat: true },
];

// ── قائمة السماح المؤرَّخة ──────────────────────────────────────────────────
// لقطة 2026-09-09 (المرحلة ١): كل ملف يتجاوز سقفه اليوم، بعدد أسطره وقتها.
// الإزالة: `api/*` بالمرحلة ٤ · `db.js`/`reviewQueue.js`/`gateway.js` بالمرحلة ٣
// · `dashboard.html`/`admin.html` بالمرحلة ٥ (ARCHITECTURE.md §٣).
const ALLOWLIST = new Map([
  ["dashboard.html", 1943],
  ["functions/_lib/core/db.js", 1351],
  ["admin.html", 916],
  ["functions/api/copy.js", 567],
  ["functions/api/whatsapp/webhook.js", 479],
  ["functions/_lib/services/reviewQueue.js", 410],
  ["functions/_lib/ai/gateway.js", 402],
  ["functions/api/cron/bulk_process.js", 272],
  ["functions/api/chat.js", 262],
  ["functions/api/webhooks/salla.js", 257],
  ["functions/api/support.js", 229],
  ["functions/api/instagram/webhook.js", 213],
  ["functions/api/auth/google.js", 187],
  ["functions/api/cron/reminders.js", 172],
  ["functions/api/cron/healthcheck.js", 171],
  ["functions/api/whatsapp/connect.js", 154],
  ["functions/api/health.js", 146],
  ["functions/api/admin/aura_whatsapp.js", 142],
  ["functions/api/auth/reset_password.js", 140],
  ["functions/api/auth/signup.js", 129],
  ["functions/api/store/catalog/sync.js", 129],
  ["functions/api/store/overview.js", 123],
  ["functions/api/store/persona.js", 118],
  ["functions/api/auth/complete_account.js", 115],
  ["functions/api/auth/salla/callback.js", 115],
  ["functions/api/auth/login.js", 111],
  ["functions/api/auth/forgot_password.js", 110],
  ["functions/api/store/review/decide.js", 109],
  ["functions/api/store/bulk/generate.js", 107],
]);
const EXPECTED_ALLOWLIST = 29;

const SKIP_DIRS = new Set(["node_modules", "dist", "archive", ".git", "backups", "graphify-out", ".wrangler"]);
function walk(dir, ext, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}
const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");
const lineCount = (p) => readFileSync(p, "utf8").split("\n").length;

const failures = [];
const seenAllowed = new Set();
const snapshot = [];

for (const { label, dir, ext, cap, flat } of CAPS) {
  const base = join(ROOT, dir);
  if (!existsSync(base)) continue;
  const files = flat
    ? readdirSync(base).filter((n) => n.endsWith(ext)).map((n) => join(base, n))
    : walk(base, ext);
  for (const f of files) {
    const r = rel(f);
    const n = lineCount(f);
    if (n <= cap) {
      if (ALLOWLIST.has(r)) seenAllowed.add(r); // نزل تحت السقف — تنظيف الاستثناء لاحقاً، لا فشل
      continue;
    }
    snapshot.push([r, n]);
    if (!ALLOWLIST.has(r)) {
      failures.push(`${r}: ${n} سطراً > سقف ${label} (${cap}) — قسّمه أو سجّله بقائمة السماح بسبب ومرحلة إزالة.`);
      continue;
    }
    seenAllowed.add(r);
    const recorded = ALLOWLIST.get(r);
    if (n > recorded) {
      failures.push(`${r}: كبر من ${recorded} إلى ${n} سطراً — الملف المسموح يُقلَّص لا يُزاد (سقفه ${cap}).`);
    }
  }
}

if (process.env.AUDIT_PRINT_ALLOWLIST) {
  snapshot.sort((a, b) => b[1] - a[1]);
  for (const [f, n] of snapshot) console.log(`  ["${f}", ${n}],`);
  console.log(`  // EXPECTED_ALLOWLIST = ${snapshot.length}`);
  process.exit(0);
}

if (ALLOWLIST.size > EXPECTED_ALLOWLIST) {
  failures.push(`عدد الاستثناءات ${ALLOWLIST.size} > المسموح ${EXPECTED_ALLOWLIST} — القائمة تتقلّص ولا تكبر.`);
}
for (const r of ALLOWLIST.keys()) {
  if (!seenAllowed.has(r) && existsSync(join(ROOT, r))) {
    failures.push(`استثناء لم يعد لازماً: ${r} نزل تحت سقفه — احذفه من ALLOWLIST وأنقص EXPECTED_ALLOWLIST.`);
  }
}

if (failures.length) {
  console.error("✖ تدقيق أحجام الملفات —");
  for (const x of failures) console.error("  " + x);
  process.exit(1);
}
console.log(`✔ تدقيق أحجام الملفات: السقوف ٨٠/٤٠٠/٨٠٠ محفوظة، ${ALLOWLIST.size} استثناءً مؤرَّخاً لا يكبر.`);

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
// الإزالة: `api/*` بالمرحلة ٤ · `dashboard.html`/`admin.html` بالمرحلة ٥.
// أُنجز بالمرحلة ٣ (2026-09-09): `core/db.js` ١٣٥١ → ٦٢ سطراً (shim إعادة تصدير)
// و`services/reviewQueue.js` ٤١٠ → ١٩ (shim؛ المحتوى بـ`domain/review.js` ٣٦٨
// بعد استخراج `domain/reviewGuards.js`). كل ملف بـ`domain/**` تحت سقف ٤٠٠.
// أُنجز بالمرحلة ٤ — النصف ب (2026-09-09): نقاط الدخول الذكية صارت «تنسيق فقط»
// وسقطت ستة استثناءات: `api/copy.js` ٥٦٧→٧٢ · `api/whatsapp/webhook.js` ٤٧٩→٦٧ ·
// `api/chat.js` ٢٦٢→٥٤ · `api/support.js` ٢٢٩→٢١ · `api/instagram/webhook.js`
// ٢١٣→٦٩ · `api/whatsapp/connect.js` ١٥٤→٤٩. المنطق انتقل لـ`domain/*` و
// `ai/prompts/*` وكلها تحت سقف ٤٠٠. و`ai/gateway.js` ٤٠٢→٣٠١ بعد استخراج
// `ai/vision.js` (١٠٨) — يعيد تصدير الواجهة فلا يتغيّر أي مستورد.
// أُنجز بالمرحلة ٤ — النصف أ (2026-09-09): نقاط دخول المصادقة والـcron والمتجر
// والأدمن صارت «تنسيق فقط» وسقطت استثناءاتها: `api/cron/bulk_process.js` ٢٧٢→٤١ ·
// `api/webhooks/salla.js` ٢٥٧→٨٠ · `api/auth/google.js` ١٨٧→٧٦ ·
// `api/cron/reminders.js` ١٧٢→٦٩ · `api/cron/healthcheck.js` ١٧١→٥٦ ·
// `api/health.js` ١٤٦→٤٩ · `api/admin/aura_whatsapp.js` ١٤٢→٤١ … المنطق انتقل
// إلى `domain/{auth,accounts,booking,bulk,bulkTick,health,analytics,platforms,
// salla,catalogSync,storeOverview,publish,persona,auraAgent}.js` وكلها تحت ٤٠٠.
// أُنجز بالمرحلة ٥ — النصف أ (2026-09-09): `dashboard.html` ١٩٤٣ → ٤٣ سطراً
// و`admin.html` ٩١٦ → ٤٢، بنقل العلامات إلى `partials/{dashboard,admin}-*.html`
// (تُحَل بـ#include وقت البناء) والـJS إلى وحدات ES بـ`public/js/{dashboard,
// admin}/*.js`. لا ملف من الوحدات الجديدة يتجاوز ٤٠٠ سطر. سقط الاستثناءان.
// أُنجز بالمرحلة ٦ (2026-09-09): `api/webhooks/salla.js` ٨١ → تحت السقف، بنقل
// كتلة ما بعد التوقيع (التصريف + حجب التوكنات + `logWebhook`) إلى
// `domain/salla.js:processVerifiedSallaEvent`. النقطة صارت: JSON ← تحقق توقيع
// ← waitUntil(domain) ← 200. **قائمة السماح صارت فارغة** (ARCHITECTURE.md §٣:
// «كل الحراس بلا قوائم سماح») — وقاعدة §٤ تمنع إضافة أي مدخل جديد.
const ALLOWLIST = new Map([]);
const EXPECTED_ALLOWLIST = 0;

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

#!/usr/bin/env node
/**
 * تدقيق العزل الآلي (docs/PARALLEL_TRACKS.md §أ.١.ت / D5).
 *
 * لماذا: عزل المتاجر عند مطوّر واحد لا يقدر يعتمد على "الانتباه" — لازم فحص
 * آلي يفشل CI/الاختبارات لو أحد كتب استعلام D1 على جدول متعدد المستأجرين
 * (فيه عمود merchant_id) بلا شرط عليه. هذا يحوّل العزل من عادة إلى ضمانة.
 *
 * الطريقة (Static-heuristic, لا AST كامل — كافٍ لحجم المشروع الحالي):
 *  ١. استخرج كل جدول فيه عمود merchant_id من migrations/*.sql
 *  ٢. امسح كل functions/** ‎.js بحثاً عن .prepare(`...`) أو .prepare("...")
 *  ٣. لكل استعلام يلمس جدول مستأجر: يجب أن يحتوي "merchant_id" حرفياً بالنص
 *  ٤. استثناء وحيد مقبول: تعليق `// tenant-audit-ok: <سبب>` بالسطر مباشرة قبل
 *     .prepare(. السبب إلزامي وليس زخرفة — يُقرأ بأي مراجعة مستقبلية. لا قائمة
 *     استثناءات مركزية بعيدة عن الكود تقدر تنحرف عنه بصمت.
 *  ٥. ملفات الأدمن (ADMIN_CROSS_TENANT_FILES) تُعفى كاملة — الحوكمة هناك عبر
 *     requireAdmin لا عبر شرط SQL، فئة مختلفة تماماً عن استثناء "هذا الاستعلام
 *     تحديداً معزول بطريقة أخرى".
 *
 * تشغيل: node scripts/audit-isolation.mjs  (أو ضمن npm test)
 * خروج غير صفري = وُجد استعلام غير معزول → يفشل الاختبار.
 *
 * ⚠️ حدّ معروف (تحقُّق يدوي 2026-09-06، لا يُصلَح آلياً الآن): الأداة تقرأ فقط
 * نص حرفي (backtick/"/') مُمرَّر مباشرة لـ.prepare(...). استعلام مبني بمتغيّر
 * (`const sql = ...; env.DB.prepare(sql)`) غير مرئي لها إطلاقاً — لا يُبلَّغ
 * كمخالفة ولا يُحتسَب "مفحوصاً"، فيمرّ الفحص بصمت. راجعت كل حالة موجودة اليوم
 * يدوياً (`db.js:501` — فرعان، كلاهما بشرط هوية واحد صحيح · `stats.js:9` —
 * تجميع عابر للمتاجر متعمَّد لعدّادات عامة، لا تسريب) ولا واحدة مخالفة فعلياً،
 * لكن هذا يعني: **"صفر مخالفة" لا يساوي "كل استعلام مفحوص"**. أي إضافة مستقبلية
 * لاستعلام بمتغيّر تحتاج مراجعة يدوية — الأداة لن تكتشفها.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, "migrations");
const SCAN_DIR = join(ROOT, "functions");

// ── استثناءات موثّقة — كل واحد له سبب مكتوب، لا "تجاهل صامت" ────────────────
//
// ملفات أدمن: قراءة عابرة للمتاجر مقصودة، مقيّدة بـ requireAdmin (S حوكمة
// منفصلة، ليست عزل tenant عادي). موجودة أصلاً بـ docs/PARALLEL_TRACKS.md §أ.١.
const ADMIN_CROSS_TENANT_FILES = new Set([
  "functions/api/admin/accounts.js",
  "functions/api/admin/bookings.js",
  "functions/api/admin/errors.js",
  "functions/api/admin/conversations.js",
  "functions/api/admin/faq.js",
  "functions/api/admin/overview.js",
  "functions/api/admin/style_library.js",
  "functions/api/admin/aura_whatsapp.js",
  "functions/api/cron/reminders.js", // يعالج كل التذكيرات المستحقة عبر كل المتاجر بالتصميم
  "functions/api/cron/bulk_process.js", // يعالج طابور كل المتاجر بالتصميم
  "functions/api/cron/healthcheck.js"
]);

// جداول فيها merchant_id لكن العزل الحقيقي يمر بجدول آخر (join)، لا بشرط مباشر
// بهذا الاستعلام نفسه. bulk_job_items: لا عمود merchant_id — يُعزَل عبر
// bulk_jobs.merchant_id (job_id مصدره صف بالفعل مُتحقَّق ملكيته). موثّق بـ
// migrations/0014_bulk_jobs.sql.
const JOIN_ISOLATED_TABLES = new Set(["bulk_job_items"]);

// جداول أحادية المستأجر بالتصميم (لا merchant_id إطلاقاً) — استشارات أورا
// نفسها، لا التاجر. تُستثنى تلقائياً لأنها لن تظهر بقائمة TENANT_TABLES أصلاً،
// موثّقة هنا فقط للتوضيح.
// const SINGLE_TENANT_TABLES = new Set(["consultation_bookings"]);

function listSqlFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => join(MIGRATIONS_DIR, f));
}

/** يستخرج أسماء الجداول اللي فيها عمود merchant_id من كل ملفات الهجرة. */
function extractTenantTables() {
  const tenantTables = new Set();
  for (const file of listSqlFiles()) {
    const sql = readFileSync(file, "utf8");
    const tableBlocks = sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\);/g);
    for (const [, tableName, body] of tableBlocks) {
      if (/\bmerchant_id\b/.test(body)) tenantTables.add(tableName);
    }
  }
  return tenantTables;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (extname(full) === ".js") out.push(full);
  }
  return out;
}

const SUPPRESS_MARKER = /tenant-audit-ok:\s*\S/;

/** يستخرج نصوص كل استدعاء .prepare(...) من ملف JS واحد، مع فحص تعليق الإعفاء
 * على السطر (أو السطرين) قبله مباشرة. */
function extractPrepareCalls(source) {
  const lines = source.split("\n");
  const calls = [];
  const re = /\.prepare\(\s*(`[\s\S]*?`|"[^"]*"|'[^']*')/g;
  let m;
  while ((m = re.exec(source))) {
    const upToMatch = source.slice(0, m.index);
    const lineNo = upToMatch.split("\n").length - 1; // 0-indexed
    // Walk up through the contiguous comment block directly above the call
    // (handles multi-line // explanations, not just a single adjacent line).
    const commentBlock = [];
    for (let i = lineNo - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith("//")) commentBlock.push(line);
      else break;
    }
    const suppressed = SUPPRESS_MARKER.test(commentBlock.join("\n"));
    calls.push({ query: m[1].slice(1, -1), suppressed });
  }
  return calls;
}

function tableTouchedBy(query) {
  const m = query.match(/\b(?:FROM|INTO|UPDATE)\s+(\w+)/i);
  return m ? m[1] : null;
}

/**
 * حارس صحّة الأداة نفسها — يمنع الفحص من "الفشل بصمت" (regex ينكسر فيرجّع
 * صفر مخالفة دايماً، فيبدو كل شي سليم بينما الفحص فعلياً معطّل). يُشغَّل قبل
 * كل تدقيق حقيقي، ويفشل الفحص كله لو تصرّف كاشف الاستثناء أو استخراج
 * الاستعلامات بعكس المتوقَّع على عيّنة معروفة.
 */
function selfTest() {
  const bad = `env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(id).first()`;
  const goodMarked = `  // tenant-audit-ok: test fixture\n  env.DB.prepare("SELECT * FROM accounts WHERE merchant_id = ?").bind(m).first()`;
  const goodInline = `env.DB.prepare("SELECT * FROM accounts WHERE merchant_id = ?").bind(m).first()`;

  const [badCall] = extractPrepareCalls(bad);
  if (badCall.suppressed) throw new Error("self-test failed: unmarked unsafe query reported as suppressed");
  if (tableTouchedBy(badCall.query) !== "accounts") throw new Error("self-test failed: table extraction broken");
  if (/\bmerchant_id\b/.test(badCall.query)) throw new Error("self-test failed: merchant_id false-positive on unsafe query");

  const [markedCall] = extractPrepareCalls(goodMarked);
  if (!markedCall.suppressed) throw new Error("self-test failed: tenant-audit-ok marker not detected");

  if (!/\bmerchant_id\b/.test(extractPrepareCalls(goodInline)[0].query)) {
    throw new Error("self-test failed: merchant_id not detected on a safe query");
  }
}

function main() {
  selfTest();
  const tenantTables = extractTenantTables();
  const jsFiles = walk(SCAN_DIR);
  const violations = [];

  for (const file of jsFiles) {
    const relPath = file.slice(ROOT.length + 1).replace(/\\/g, "/");
    const source = readFileSync(file, "utf8");
    const calls = extractPrepareCalls(source);

    for (const { query, suppressed } of calls) {
      const table = tableTouchedBy(query);
      if (!table || !tenantTables.has(table)) continue;
      if (JOIN_ISOLATED_TABLES.has(table)) continue;
      if (ADMIN_CROSS_TENANT_FILES.has(relPath)) continue;
      if (/\bmerchant_id\b/.test(query)) continue;
      if (suppressed) continue;

      violations.push({ file: relPath, table, query: query.trim().slice(0, 160) });
    }
  }

  if (violations.length === 0) {
    console.log(`✔ تدقيق العزل: صفر استعلام غير معزول (${tenantTables.size} جدول مستأجر مفحوص).`);
    return 0;
  }

  console.error(`✖ تدقيق العزل: ${violations.length} استعلام على جدول متعدد المستأجرين بلا merchant_id:\n`);
  for (const v of violations) {
    console.error(`  ${v.file} — جدول "${v.table}"\n    ${v.query}\n`);
  }
  console.error(
    "إصلاح: أضف شرط merchant_id، أو لو استثناء متعمَّد أضفه لقائمة الاستثناءات\n" +
      "الموثّقة أعلى scripts/audit-isolation.mjs مع سبب صريح — لا تتجاهل الفحص."
  );
  return 1;
}

process.exit(main());

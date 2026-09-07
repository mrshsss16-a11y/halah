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
 * ── تغطية المرورين (أُضيف 2026-09-06، المرحلة ١) ────────────────────────────
 * المرور ١ (الأصلي): نص حرفي مُمرَّر مباشرة لـ.prepare(...).
 * المرور ٢ (جديد): **أي** نص حرفي في الملف يبدو استعلام SQL على جدول مستأجر،
 *   مهما كانت طريقة وصوله لـ.prepare(). هذا يغطي الحالة التي كانت عمياء تماماً:
 *   `const sql = "..."; env.DB.prepare(sql)` — كانت تمرّ بصمت، لا تُبلَّغ ولا
 *   تُحتسَب مفحوصة، فتُنتج ثقة زائفة أخطر من غياب الأداة (قاعدة م٥،
 *   docs/AGENT_ORCHESTRATION.md).
 *
 * المرور ٢ متعمَّد الحساسية: يفضّل إنذاراً كاذباً يُغلَق بتعليق مبرَّر، على
 * تسريب صامت. إغلاق أي حالة = تعليق `// tenant-audit-ok: <سبب>` فوق النص نفسه.
 *
 * ما يبقى خارج التغطية (صريح، لا تُدّعى تغطيته): استعلام يُبنى بتركيب سلاسل
 * متفرّقة (`"SELECT * FROM " + table`) لا يظهر كنص SQL كامل في أي حرفية واحدة.
 * لا توجد حالة كهذه اليوم؛ لو أُضيفت مستقبلاً فهي خارج قدرة الفحص النصي وتحتاج
 * مراجعة بشرية.
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
 * المرور ٢: كل نص حرفي في الملف يبدو استعلاماً، بغضّ النظر عن طريقة وصوله
 * لـ.prepare(). يلتقط `const sql = "..."` والشرطي (ternary) بفرعيه — وهما
 * الشكلان الموجودان فعلياً بالمشروع (db.js، stats.js، dlq.js، reminders.js).
 *
 * فحص الإعفاء هنا يختلف عن المرور ١: التعليق قد يكون فوق تعريف المتغيّر لا
 * فوق .prepare()، فنبحث في الكتلة التعليقية فوق سطر النص نفسه.
 */
// يجب أن *يبدأ* النص بفعل SQL، لا أن يحتويه في مكان ما.
// السبب (باغ حقيقي وقع 2026-09-06 أثناء بناء المرور ٢): مطابقة الـbacktick
// بالتناوب تُزاوج علامة إغلاق مع علامة فتح تالية، فتلتقط **الكود الواقع بين
// نصّين** وكأنه نص واحد. اشتراط البداية يلغي هذه الفئة كلياً، ويضيّق الإنذارات
// الكاذبة، لأن كل استعلام حقيقي يبدأ بفعله.
const SQL_SHAPE = /^\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WITH)\b/i;

function extractSqlLiterals(source) {
  const lines = source.split("\n");
  const out = [];
  const re = /(`[^`]*`|"[^"]*"|'[^']*')/g;
  let m;
  while ((m = re.exec(source))) {
    const text = m[1].slice(1, -1);
    if (!SQL_SHAPE.test(text)) continue;

    const lineNo = source.slice(0, m.index).split("\n").length - 1;
    const commentBlock = [];
    // الصعود لأعلى بحثاً عن كتلة التعليق. لا نتوقف عند أول سطر غير تعليقي:
    // الشكل الشائع بالمشروع يضع النص في سطر مستقل تحت `.prepare(`، فالتعليق
    // المبرِّر يقع فوق `.prepare(` لا فوق النص مباشرة. تجاهُل ذلك جعل الفحص
    // يبلّغ عن استعلامات معفاة فعلاً (باغ حقيقي، 2026-09-06). لذا نتخطى أسطر
    // استمرار الجملة (فارغة أو منتهية بقوس فتح) ونواصل الصعود.
    for (let i = lineNo - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith("//") || line.startsWith("*")) {
        commentBlock.push(line);
        continue;
      }
      // أسطر استمرار الجملة نفسها فقط: قوس فتح، أو فرعا الشرطي (؟ / :).
      // الشرطي متعدد الأسطر جملة واحدة، فالتعليق فوقه يغطي فرعيه معاً
      // (revokeWaConnection بـdb.js). ما عدا ذلك يقطع الصعود عمداً حتى لا
      // يصير تعليق قديم إعفاءً عرضياً لاستعلام لا صلة له به.
      // رأس الشرطي: `const sql = merchantId` ثم فرعاه بسطرين تاليين. بلا هذا
      // الاستثناء يقف الصعود عند الرأس فلا يُرى التعليق فوقه (db.js
      // revokeWaConnection). مضبوط ضيقاً: إسناد ينتهي بمعرّف بلا فاصلة منقوطة،
      // أي جملة غير مكتملة يقيناً.
      if (line === "" || /[({]$/.test(line) || /^[?:]/.test(line) || /=\s*[\w.]+$/.test(line)) continue;
      break;
    }
    out.push({
      query: text,
      suppressed: SUPPRESS_MARKER.test(commentBlock.join("\n")),
      line: lineNo + 1
    });
  }
  return out;
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

  // ── المرور ٢: الحالة التي كانت عمياء تماماً قبل 2026-09-06 ──
  const viaVariable = `const sql = "SELECT * FROM accounts WHERE id = ?";\n  await env.DB.prepare(sql).bind(id).first()`;
  const seenByPass1 = extractPrepareCalls(viaVariable);
  if (seenByPass1.length !== 0) {
    throw new Error("self-test failed: pass 1 unexpectedly matched a variable-passed query");
  }
  const seenByPass2 = extractSqlLiterals(viaVariable);
  if (seenByPass2.length !== 1 || tableTouchedBy(seenByPass2[0].query) !== "accounts") {
    throw new Error("self-test failed: pass 2 missed a variable-assigned SQL literal");
  }
  if (seenByPass2[0].suppressed) {
    throw new Error("self-test failed: pass 2 reported an unmarked query as suppressed");
  }

  // إعفاء المرور ٢ يُقرأ من التعليق فوق تعريف المتغيّر، لا فوق .prepare()
  const markedVariable = `// tenant-audit-ok: test fixture\n  const sql = "SELECT * FROM accounts WHERE id = ?";`;
  if (!extractSqlLiterals(markedVariable)[0].suppressed) {
    throw new Error("self-test failed: pass 2 ignored the tenant-audit-ok marker above a variable");
  }

  // نص عادي ليس SQL يجب ألا يدخل المرور ٢ إطلاقاً (ضبط الحساسية)
  if (extractSqlLiterals(`const msg = "حدث خطأ، حاول مرة ثانية";`).length !== 0) {
    throw new Error("self-test failed: pass 2 false-positive on a non-SQL string");
  }

  // الشكل الحقيقي السائد بالمشروع: التعليق فوق `.prepare(`، والنص بالسطر التالي.
  // كان يُبلَّغ خطأً كمخالفة رغم وجود الإعفاء (باغ 2026-09-06).
  const markerAbovePrepare = `  // tenant-audit-ok: verified by OTP\n  const update = await env.DB.prepare(\n    "UPDATE accounts SET x = ? WHERE email = ?"\n  )`;
  if (!extractSqlLiterals(markerAbovePrepare)[0].suppressed) {
    throw new Error("self-test failed: pass 2 missed a marker sitting above .prepare(");
  }

  // ومع ذلك: سطر كود حقيقي بين التعليق والنص يجب أن يقطع الصعود، وإلا صار
  // أي تعليق قديم في الملف إعفاءً عرضياً لاستعلام لا علاقة له به.
  const unrelatedMarker = `  // tenant-audit-ok: unrelated older note\n  const other = compute();\n  const sql = "SELECT * FROM accounts WHERE id = ?";`;
  if (extractSqlLiterals(unrelatedMarker)[0].suppressed) {
    throw new Error("self-test failed: pass 2 leaked a marker across an unrelated statement");
  }

  // الشرطي متعدد الأسطر (شكل revokeWaConnection بـdb.js): التعليق فوق الرأس
  // يغطي الفرعين. الفرع الثاني كان يُبلَّغ خطأً لأن الصعود يقف عند الرأس.
  const ternary = `  // tenant-audit-ok: alternate unique key\n  const sql = merchantId\n    ? "UPDATE wa SET s = 1 WHERE merchant_id = ?"\n    : "UPDATE wa SET s = 1 WHERE waba_id = ?";`;
  const branches = extractSqlLiterals(ternary);
  if (branches.length !== 2 || !branches[1].suppressed) {
    throw new Error("self-test failed: pass 2 missed a marker above a multi-line ternary head");
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

    // المروران معاً. المرور ٢ أوسع ويبتلع نتائج ١ غالباً، لكن ١ يبقى لأنه
    // يفحص التعليق فوق .prepare() تحديداً (موضع مختلف عن تعريف المتغيّر).
    const candidates = [
      ...extractPrepareCalls(source).map((c) => ({ ...c, line: null })),
      ...extractSqlLiterals(source)
    ];

    const seen = new Set();

    for (const { query, suppressed, line } of candidates) {
      const table = tableTouchedBy(query);
      if (!table || !tenantTables.has(table)) continue;
      if (JOIN_ISOLATED_TABLES.has(table)) continue;
      if (ADMIN_CROSS_TENANT_FILES.has(relPath)) continue;
      if (/\bmerchant_id\b/.test(query)) continue;
      if (suppressed) continue;

      // نفس الاستعلام قد يُلتقط بالمرورين — بلاغ واحد يكفي.
      const key = `${relPath}::${query.trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      violations.push({ file: relPath, table, line, query: query.trim().slice(0, 160) });
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

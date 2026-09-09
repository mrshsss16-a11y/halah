#!/usr/bin/env node
/**
 * حارس تطابق المخطط مع الكود (docs/ARCHITECTURE.md §٤، المرحلة ١).
 *
 * لماذا: عمود يُكتب بـSQL الكود ولا وجود له بأي هجرة = خطأ D1 وقت التشغيل فقط،
 * على الإنتاج، بمسار قد لا يمرّ عليه أي اختبار (ويبهوك، cron). والعكس — جدول
 * بالمخطط لا يذكره أحد — دَين صامت يوهم القارئ أن الميزة تعمل (قاعدة الصدق، AGENT.md §١١).
 *
 * ثلاثة فحوص:
 *   م١  كل جدول+عمود يظهر بنص SQL داخل `functions/**` موجود فعلاً بالمخطط.
 *   م٢  كل جدول بالمخطط يذكره الكود (قائمة سماح للجداول القديمة الموثّقة بـAGENT.md §٦).
 *   م٣  لا هجرة بالملفات غير مطبَّقة على البعيد — **فقط لو** توفّرت الأداة الخارجية.
 *       `npx wrangler d1 migrations list halah-tr-db --remote` بمهلة ٢٠ ثانية؛ لو فشل
 *       (لا شبكة، لا تسجيل دخول، لا صلاحية) نطبع تحذيراً ولا نفشل. الفشل هنا كان
 *       سيعني «npm test لا يعمل بلا إنترنت» — وهذا يُعطَّل الحارس كله بعد أسبوع.
 *
 * الفحص نصي بالكامل (لا محلّل SQL): يفضّل إنذاراً كاذباً يُغلَق بقائمة سماح على
 * تسريب صامت — نفس فلسفة scripts/audit-isolation.mjs.
 *
 * تشغيل: node scripts/audit-migrations.mjs  (ضمن npm test)
 * متغيرات بيئة: AUDIT_MIG_ROOT (شجرة وهمية للاختبار) · AUDIT_MIG_SKIP_REMOTE=1 (تخطي م٣)
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.env.AUDIT_MIG_ROOT ? join(process.cwd(), process.env.AUDIT_MIG_ROOT) : process.cwd();
const MIGRATIONS_DIR = join(ROOT, "migrations");
const SCAN_DIR = join(ROOT, "functions");

// ── قائمة سماح م٢: جداول بالمخطط لا يذكرها الكود ────────────────────────────
// كل سطر بتاريخ وسبب ومرحلة الإزالة (قاعدة القائمة البيضاء، ARCHITECTURE.md §٤).
const UNUSED_TABLE_ALLOWLIST = new Map([
  // 2026-09-09 · جداول legacy من بناء سابق، موثّقة حرفياً بـAGENT.md §٦:
  // «جداول قديمة (legacy) لا تزال موجودة من بناء سابق … الجداول الجديدة حلّت محلها».
  // لا تُحذف بهجرة قبل نسخة احتياطية متحقَّق منها + قرار المالك (AGENT.md §٦).
  ["users", "legacy — AGENT.md §٦، حلّت محلها accounts/merchants"],
  ["faqs", "legacy — AGENT.md §٦، حلّ محلها store_faqs"],
  ["store_connections", "legacy — AGENT.md §٦، حلّ محلها oauth_tokens/wa_connections"],
  ["synced_products", "legacy — AGENT.md §٦، حلّ محلها store_products"],
  ["merchant_marketing_contexts", "legacy — AGENT.md §٦"],
  ["store_documents", "legacy — AGENT.md §٦"],
  // 2026-09-09 · جدول وصفي يُقرأ بأدوات التشغيل لا بالكود.
  ["merchants_meta", "بيانات وصفية تشغيلية — لا مسار كود يقرأها اليوم"],
  // 2026-09-09 · مخطط ميزة إعادة الاستهداف: دوالها بـdb.js كانت ميتة (صفر مستدعٍ)
  // وحُذفت بالمرحلة ١. الجدول يبقى حتى قرار المالك: يُحذف بهجرة أو تُبنى الميزة.
  // الحسم: المرحلة ٦ (ARCHITECTURE.md §٣) — لا يُحذف بلا نسخة احتياطية (AGENT.md §٦).
  ["pending_retargeting", "مخطط بلا ميزة — دواله الميتة حُذفت بالمرحلة ١، والحسم بالمرحلة ٦"],
]);
const EXPECTED_UNUSED_TABLES = 8;

const failures = [];
const warnings = [];

function walk(dir, ext, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (["node_modules", "dist", "archive", ".git", ".wrangler"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}
const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");
const norm = (s) => s.replace(/["'`\[\]]/g, "").trim().toLowerCase();
// اسم عمود صالح. `?` (بديل قالب `${...}`) ليس عموداً — بلا هذا الفلتر يُبلَّغ عن
// «العمود `agent_profiles.?` غير موجود» وهو ضجيج يُفقد الحارس مصداقيته.
const isColumnName = (n) => /^[a-z_][a-z0-9_]*$/.test(n);

// ── ١. المخطط من migrations/*.sql ───────────────────────────────────────────
/** @type {Map<string, Set<string>>} table → columns */
const schema = new Map();
const addCol = (t, c) => {
  if (!t || !c) return;
  if (!schema.has(t)) schema.set(t, new Set());
  schema.get(t).add(c);
};

const sqlFiles = existsSync(MIGRATIONS_DIR)
  ? readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql")).sort()
  : [];

for (const name of sqlFiles) {
  const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8")
    .replace(/--[^\n]*/g, "")           // تعليقات سطرية
    .replace(/\/\*[\s\S]*?\*\//g, "");  // تعليقات كتلية

  // CREATE TABLE [IF NOT EXISTS] t ( ... )
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"'\[\]\w.]+)\s*\(/gi)) {
    const table = norm(m[1]);
    if (!schema.has(table)) schema.set(table, new Set());
    // اقتطع جسم التعريف بموازنة الأقواس من موضع القوس المفتوح
    let depth = 0, i = m.index + m[0].length - 1, end = -1;
    for (; i < sql.length; i++) {
      if (sql[i] === "(") depth++;
      else if (sql[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) continue;
    const body = sql.slice(m.index + m[0].length, end);
    // قسّم على الفواصل من المستوى الأعلى فقط (لتجنّب فواصل داخل CHECK(...))
    const parts = [];
    let cur = "", d = 0;
    for (const ch of body) {
      if (ch === "(") d++;
      else if (ch === ")") d--;
      if (ch === "," && d === 0) { parts.push(cur); cur = ""; } else cur += ch;
    }
    parts.push(cur);
    for (const part of parts) {
      const t = part.trim();
      if (!t) continue;
      if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|KEY)\b/i.test(t)) continue;
      const cm = t.match(/^([`"'\[\]\w]+)/);
      if (cm) addCol(table, norm(cm[1]));
    }
  }

  // ALTER TABLE t ADD [COLUMN] c ...
  for (const m of sql.matchAll(/ALTER\s+TABLE\s+([`"'\[\]\w.]+)\s+ADD\s+(?:COLUMN\s+)?([`"'\[\]\w]+)/gi)) {
    addCol(norm(m[1]), norm(m[2]));
  }
  // CREATE INDEX ... ON t (...)  — يثبت وجود الجدول ولو لم يعرّف أعمدة
  for (const m of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"'\[\]\w.]+\s+ON\s+([`"'\[\]\w.]+)/gi)) {
    const t = norm(m[1]);
    if (!schema.has(t)) schema.set(t, new Set());
  }
}

if (!schema.size) {
  console.error("✖ تدقيق الهجرات: لم يُقرأ أي جدول من migrations/ — الفحص بلا معنى، لا تمرّره بصمت.");
  process.exit(1);
}

// ── ٢. الاستعمال بالكود ─────────────────────────────────────────────────────
const usedTables = new Set();
/** @type {{file:string, table:string, column:string}[]} */
const usedColumns = [];

const RESERVED = new Set([
  "select", "from", "where", "and", "or", "not", "null", "as", "on", "set", "values",
  "insert", "into", "update", "delete", "case", "when", "then", "else", "end", "count",
  "sum", "max", "min", "avg", "distinct", "group", "order", "by", "limit", "offset",
  "join", "left", "inner", "outer", "conflict", "do", "nothing", "returning", "exists",
  "in", "is", "like", "between", "desc", "asc", "having", "union", "all", "coalesce",
  "datetime", "date", "now", "cast", "strftime", "json_extract", "rowid", "excluded",
]);

for (const f of walk(SCAN_DIR, ".js")) {
  const r = rel(f);
  const src = readFileSync(f, "utf8");
  // كل حرفية نصية تبدو استعلام SQL. كل نوع اقتباس بنمط مستقل يستثني **نوعه هو**
  // فقط: نمط واحد يستثني الثلاثة كان يفشل على `... status = 'active'` داخل قالب
  // خلفي — وهو الشكل الغالب للاستعلامات هنا، فيسقط جداول حقيقية بصمت.
  const literals = [
    ...src.matchAll(/`((?:[^`\\]|\\.)*)`/g),
    ...src.matchAll(/"((?:[^"\\\n]|\\.)*)"/g),
    ...src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g),
  ];
  for (const m of literals) {
    const text = m[1];
    if (!/\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i.test(text)) continue;
    const sql = text.replace(/\$\{[^}]*\}/g, " ? "); // بدائل القوالب

    // الجداول: FROM t · JOIN t · INSERT INTO t · UPDATE t · DELETE FROM t
    for (const tm of sql.matchAll(/\b(?:FROM|JOIN|INSERT\s+INTO|UPDATE)\s+([`"'\[\]\w.]+)/gi)) {
      const t = norm(tm[1]);
      if (!t || RESERVED.has(t) || t === "?") continue;
      usedTables.add(t);
    }
    const tablesHere = [...sql.matchAll(/\b(?:FROM|JOIN|INSERT\s+INTO|UPDATE)\s+([`"'\[\]\w.]+)/gi)]
      .map((x) => norm(x[1]))
      .filter((t) => t && !RESERVED.has(t) && t !== "?");
    // العمود يُنسب لجدول واحد فقط لو الاستعلام يلمس جدولاً واحداً — غير ذلك
    // لا يمكن للفحص النصي أن يعرف صاحب العمود، فنكتفي بتسجيل الجدول.
    if (tablesHere.length !== 1) continue;
    const table = tablesHere[0];

    // INSERT INTO t (a, b, c)
    const ins = sql.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+[`"'\[\]\w.]+\s*\(([^)]*)\)/i);
    if (ins) for (const c of ins[1].split(",")) { const n = norm(c); if (n && !RESERVED.has(n) && isColumnName(n)) usedColumns.push({ file: r, table, column: n }); }

    // UPDATE t SET a = ?, b = ?
    const upd = sql.match(/UPDATE\s+[`"'\[\]\w.]+\s+SET\s+([\s\S]*?)(?:\bWHERE\b|$)/i);
    if (upd) for (const m2 of upd[1].matchAll(/([`"'\[\]\w]+)\s*=/g)) { const n = norm(m2[1]); if (n && !RESERVED.has(n) && isColumnName(n)) usedColumns.push({ file: r, table, column: n }); }

    // WHERE ... col = / col IS / col IN
    for (const m2 of sql.matchAll(/\b(?:WHERE|AND|OR)\s+([`"'\[\]\w.]+)\s*(?:=|<|>|!=|<>|\bIS\b|\bIN\b|\bLIKE\b)/gi)) {
      const n = norm(m2[1]).split(".").pop();
      if (n && !RESERVED.has(n) && isColumnName(n)) usedColumns.push({ file: r, table, column: n });
    }
    // ON CONFLICT (a, b)
    for (const m2 of sql.matchAll(/ON\s+CONFLICT\s*\(([^)]*)\)/gi)) {
      for (const c of m2[1].split(",")) { const n = norm(c); if (n && !RESERVED.has(n) && isColumnName(n)) usedColumns.push({ file: r, table, column: n }); }
    }
  }
}

// ── م١ ──────────────────────────────────────────────────────────────────────
const reported = new Set();
for (const { file, table, column } of usedColumns) {
  if (!schema.has(table)) continue; // جدول غير معروف: قد يكون sqlite_master أو CTE — لا ندّعي
  if (schema.get(table).has(column)) continue;
  const key = `${table}.${column}`;
  if (reported.has(key)) continue;
  reported.add(key);
  failures.push(`م١ ${file}: العمود \`${table}.${column}\` مستخدَم بالكود ولا وجود له بأي هجرة.`);
}

// ── م٢ ──────────────────────────────────────────────────────────────────────
const usedAllow = new Set();
for (const table of schema.keys()) {
  if (usedTables.has(table)) continue;
  if (UNUSED_TABLE_ALLOWLIST.has(table)) { usedAllow.add(table); continue; }
  failures.push(`م٢ migrations/: الجدول \`${table}\` بالمخطط ولا يذكره أي كود — احذفه بهجرة أو سجّله بقائمة السماح بسبب.`);
}
if (UNUSED_TABLE_ALLOWLIST.size > EXPECTED_UNUSED_TABLES) {
  failures.push(`عدد استثناءات م٢ ${UNUSED_TABLE_ALLOWLIST.size} > المسموح ${EXPECTED_UNUSED_TABLES} — القائمة تتقلّص ولا تكبر.`);
}
for (const t of UNUSED_TABLE_ALLOWLIST.keys()) {
  if (!usedAllow.has(t) && schema.has(t)) {
    failures.push(`استثناء م٢ لم يعد لازماً: \`${t}\` صار مستخدَماً — احذفه من قائمة السماح.`);
  }
}

// ── م٣ (اختياري، لا يفشل بلا شبكة) ──────────────────────────────────────────
if (!process.env.AUDIT_MIG_SKIP_REMOTE && !process.env.AUDIT_MIG_ROOT) {
  try {
    // shell:true إلزامي على ويندوز — `npx` هناك ملف .cmd و`spawnSync` يرفضه بـEINVAL.
    // الأمر سلسلة واحدة بلا أي مدخل خارجي (اسم القاعدة ثابت بالكود) — لا حقن.
    const out = execFileSync(
      "npx wrangler d1 migrations list halah-tr-db --remote",
      { timeout: 20000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: true }
    );
    const pending = sqlFiles.filter((n) => out.includes(n));
    // المخرج لا يشبه قائمة هجرات؟ لا نُعلن «صفر معلَّقة» — ذلك ادّعاء تحقّق لم يحدث.
    if (!pending.length && !/No migrations to apply/i.test(out)) {
      warnings.push("م٣ تُخطّى: مخرج wrangler لا يشبه قائمة هجرات — لا يُعتمد عليه ولا يُعتبر فشلاً.");
    } else if (pending.length) {
      failures.push(`م٣ هجرات غير مطبَّقة على halah-tr-db البعيد: ${pending.join("، ")} — طبّقها بـ\`npx wrangler d1 migrations apply halah-tr-db --remote\`.`);
    }
  } catch (err) {
    warnings.push(`م٣ تُخطّى: تعذّر تشغيل wrangler (${(err?.message || String(err)).split("\n")[0].slice(0, 80)}). لا شبكة/تسجيل دخول — لا يُعتبر فشلاً.`);
  }
}

for (const w of warnings) console.warn("⚠ " + w);
if (failures.length) {
  console.error("✖ تدقيق الهجرات —");
  for (const x of failures) console.error("  " + x);
  process.exit(1);
}
console.log(`✔ تدقيق الهجرات: ${schema.size} جدولاً بالمخطط، ${reported.size === 0 ? "صفر" : reported.size} عمود مفقود، ${UNUSED_TABLE_ALLOWLIST.size} جدول legacy مبرَّر.`);

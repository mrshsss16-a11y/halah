#!/usr/bin/env node
/**
 * مشغّل الاختبارات الموحّد (docs/ARCHITECTURE.md §٤، المرحلة ١).
 *
 * لماذا: `package.json` كان يسلسل ملفات الاختبار بـ`&&` — أول ملف يفشل يوقف
 * الباقي، فترى عطلاً واحداً وتُصلحه ثم يظهر الثاني، دورة تلو دورة. وكل ملف جديد
 * يحتاج تعديل `package.json` يدوياً، فينسى أحدهم فيبقى الاختبار غير مشغَّل ولا
 * أحد يلاحظ — أسوأ من غيابه (يوهم بتغطية غير موجودة).
 *
 * الحل: جمع `tests/**\/*.test.mjs` عودياً، تشغيل كلٍّ بعملية `node` مستقلة
 * (عزل: تسريب حالة عامة من ملف لا يلوّث غيره)، بلا توقف عند أول فشل، ثم ملخّص
 * واحد و`exit 1` لو فشل أي ملف.
 *
 * تشغيل: node scripts/run-tests.mjs  (أول أمر بـnpm test)
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const TESTS_DIR = join(ROOT, "tests");

function collect(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collect(p, out);
    else if (p.endsWith(".test.mjs")) out.push(p);
  }
  return out;
}

const files = collect(TESTS_DIR);
if (!files.length) {
  console.error("✖ المشغّل: لم يُعثر على أي ملف *.test.mjs تحت tests/ — لا تمرّر صفر اختبارات كنجاح.");
  process.exit(1);
}

const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");
const failed = [];
const started = Date.now();

for (const f of files) {
  const r = rel(f);
  console.log(`\n${"─".repeat(70)}\n▶ ${r}\n${"─".repeat(70)}`);
  const res = spawnSync(process.execPath, [f], { stdio: "inherit", cwd: ROOT });
  const code = res.status ?? 1;
  if (code !== 0) failed.push({ file: r, code, signal: res.signal || null });
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${"═".repeat(70)}`);
console.log(`ملخّص الاختبارات — ${files.length} ملفاً، ${files.length - failed.length} ناجح، ${failed.length} فاشل (${seconds}s)`);
for (const f of files) {
  const bad = failed.find((x) => x.file === rel(f));
  console.log(`  ${bad ? "✖" : "✔"} ${rel(f)}${bad ? `  (خروج ${bad.code}${bad.signal ? `، إشارة ${bad.signal}` : ""})` : ""}`);
}
console.log("═".repeat(70));

if (failed.length) {
  console.error(`✖ فشل ${failed.length} من ${files.length} ملفات الاختبار.`);
  process.exit(1);
}
console.log(`✔ كل ملفات الاختبار (${files.length}) نجحت.`);

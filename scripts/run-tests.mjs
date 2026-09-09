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

// dashboard.html/admin.html صارا قالبين فارغين بعد تقسيمهما إلى partials/ +
// public/js/** — الاختبارات التي تفحص "شكل الكود" تقرأ dist/<name>.html
// المركَّب (tests/_helpers.mjs readComposedPage) لا الجذر. لا نجبر المطوّر
// ببناء يدوي قبل كل تشغيل: نبني هنا تلقائياً إن كان dist غائباً أو ناقصاً.
if (!existsSync(join(ROOT, "dist", "dashboard.html")) || !existsSync(join(ROOT, "dist", "admin.html"))) {
  console.log("▶ dist/ غائب أو ناقص — تشغيل npm run build أولاً…");
  const build = spawnSync(process.execPath, [join(ROOT, "scripts", "stage.mjs")], { stdio: "inherit", cwd: ROOT });
  if ((build.status ?? 1) !== 0) {
    console.error("✖ فشل البناء (scripts/stage.mjs) — لا يمكن تشغيل الاختبارات بلا dist/.");
    process.exit(1);
  }
}

// المرحلة ٥ (النصف ب) — بعد تقسيم tests/api.test.mjs (٤٥٣ تأكيداً) إلى
// tests/unit/*.test.mjs، هذا الرقم أدنى حد لمجموع التأكيدات المجمّعة من كل
// الملفات. لو انخفض المجموع (نقل ناقص، حذف طارئ لملف) نفشل بدل تمرير صامت.
const EXPECTED_MIN_ASSERTIONS = 884;

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
let totalAssertions = 0;
const perFile = [];

// كل ملفات الاختبار تطبع ملخصاً بأحد هذين الشكلين قبل الخروج:
//   "Test Summary: N/M Passed."  أو  "N/M tests passed." أو "N/M passed."
//   (النمط N/M) — أو، لملف الحرّاس الذي يعدّ نجاحاً/فشلاً بشكل عربي منفصل:
//   "P تأكيداً ناجحاً، F فاشلاً."
function parseAssertionCount(output) {
  const slashMatches = [...output.matchAll(/(\d+)\/(\d+)\s*(?:tests? )?[Pp]assed/g)];
  if (slashMatches.length) {
    const [, , m] = slashMatches[slashMatches.length - 1];
    return Number(m);
  }
  const arabicMatch = output.match(/(\d+)\s*تأكيداً ناجحاً[،,]?\s*(\d+)\s*فاشلاً/);
  if (arabicMatch) return Number(arabicMatch[1]) + Number(arabicMatch[2]);
  return null;
}

for (const f of files) {
  const r = rel(f);
  console.log(`\n${"─".repeat(70)}\n▶ ${r}\n${"─".repeat(70)}`);
  const res = spawnSync(process.execPath, [f], { stdio: ["inherit", "pipe", "pipe"], cwd: ROOT, encoding: "utf8" });
  process.stdout.write(res.stdout || "");
  process.stderr.write(res.stderr || "");
  const code = res.status ?? 1;
  if (code !== 0) failed.push({ file: r, code, signal: res.signal || null });

  const count = parseAssertionCount(`${res.stdout || ""}\n${res.stderr || ""}`);
  perFile.push({ file: r, count });
  if (count != null) totalAssertions += count;
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${"═".repeat(70)}`);
console.log(`ملخّص الاختبارات — ${files.length} ملفاً، ${files.length - failed.length} ناجح، ${failed.length} فاشل (${seconds}s)`);
for (const f of files) {
  const bad = failed.find((x) => x.file === rel(f));
  const pf = perFile.find((x) => x.file === rel(f));
  const countNote = pf && pf.count != null ? ` [${pf.count} تأكيد]` : " [لم يُقرأ عدد التأكيدات]";
  console.log(`  ${bad ? "✖" : "✔"} ${rel(f)}${countNote}${bad ? `  (خروج ${bad.code}${bad.signal ? `، إشارة ${bad.signal}` : ""})` : ""}`);
}
console.log(`مجموع التأكيدات المجمّعة: ${totalAssertions} (الحد الأدنى المطلوب: ${EXPECTED_MIN_ASSERTIONS})`);
console.log("═".repeat(70));

if (totalAssertions < EXPECTED_MIN_ASSERTIONS) {
  console.error(
    `✖ مجموع التأكيدات (${totalAssertions}) أقل من الحد الأدنى (${EXPECTED_MIN_ASSERTIONS}) — تأكيدات فُقدت أو ملف لا يطبع ملخصاً مفهوماً.`
  );
  process.exit(1);
}

if (failed.length) {
  console.error(`✖ فشل ${failed.length} من ${files.length} ملفات الاختبار.`);
  process.exit(1);
}
console.log(`✔ كل ملفات الاختبار (${files.length}) نجحت.`);

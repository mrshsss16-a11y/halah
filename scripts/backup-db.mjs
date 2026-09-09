#!/usr/bin/env node
/**
 * نسخ احتياطي لقاعدة D1 الحية (halah-tr-db).
 *
 * لماذا: المشروع يُطوَّر ويُشغَّل من شخص واحد. هجرة خاطئة أو حذف عرضي بلا نسخة
 * احتياطية = نهاية المشروع. هذا السكربت يجعل أخذ النسخة أمراً واحداً.
 *
 *   npm run backup            نسخة كاملة (مخطط + بيانات)
 *   npm run backup -- --schema-only    المخطط فقط (بلا بيانات عملاء)
 *
 * ⚠️ النسخ تحتوي بيانات عملاء حقيقية (جوالات، إيميلات، محادثات).
 *    مجلد backups/ مستثنى من git — لا تلغِ الاستثناء ولا ترفعه لأي مكان عام.
 *
 * خذ نسخة **قبل** أي `wrangler d1 migrations apply` على البعيد.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DB_NAME = 'halah-tr-db';
const BACKUP_DIR = resolve(process.cwd(), 'backups');
const KEEP = 14; // نحتفظ بآخر ١٤ نسخة، والأقدم يُحذف

const schemaOnly = process.argv.includes('--schema-only');

// طابع زمني قابل للفرز أبجدياً: 2026-09-05T14-32-08
const stamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+$/, '');
const suffix = schemaOnly ? 'schema' : 'full';
const outFile = join(BACKUP_DIR, `${DB_NAME}_${stamp}_${suffix}.sql`);

mkdirSync(BACKUP_DIR, { recursive: true });

const args = ['wrangler', 'd1', 'export', DB_NAME, '--remote', '--output', outFile];
if (schemaOnly) args.push('--no-data');

console.log(`📦 أخذ نسخة احتياطية من ${DB_NAME} (${schemaOnly ? 'مخطط فقط' : 'كاملة'})...`);

// ويندوز يشغّل npx عبر npx.cmd، وnode لا يقدر يشغّل ملفات .cmd بلا shell:true
// (EINVAL مباشر — جُرِّب وفشل). shell:true إذاً إلزامي هنا لا اختياري. الأمان
// سليم رغم تحذير Node: كل عنصر بـ`args` إما ثابت أو `outFile` (مبنيّ من
// DB_NAME/stamp/suffix الثابتة بالأعلى) — صفر مدخل مستخدم يمر لهذا الاستدعاء.
try {
  execFileSync('npx', args, { stdio: 'inherit', shell: true });
} catch (err) {
  console.error('\n✖ فشل التصدير. تحقق من تسجيل الدخول: npx wrangler login');
  process.exit(1);
}

// تحقق من أن النسخة ليست فارغة أو مبتورة — ملف موجود لا يعني نسخة صالحة
let size;
try {
  size = statSync(outFile).size;
} catch {
  console.error('✖ لم يُنشأ ملف النسخة إطلاقاً.');
  process.exit(1);
}

if (size < 1024) {
  console.error(`✖ النسخة صغيرة بشكل مريب (${size} بايت) — يُرجَّح أنها مبتورة. لا تعتمد عليها.`);
  process.exit(1);
}

// O5: تحقق بسيط من محتوى النسخة — ملف موجود وبحجم معقول لا يعني أنه تصدير
// SQL صالح (مثلاً خطأ مصادقة قد يكتب رسالة قصيرة نسبياً). نتحقق من وجود
// جدول أساسي معروف وعدد أسطر معقول قبل الوثوق بالنسخة.
const content = readFileSync(outFile, 'utf8');
const lineCount = content.split('\n').length;
if (!content.includes('CREATE TABLE accounts')) {
  console.error('✖ النسخة لا تحوي "CREATE TABLE accounts" — يُرجَّح أنها فاشلة أو مبتورة. لا تعتمد عليها.');
  process.exit(1);
}
if (lineCount <= 100) {
  console.error(`✖ النسخة قصيرة بشكل مريب (${lineCount} سطر) — يُرجَّح أنها فاشلة أو مبتورة. لا تعتمد عليها.`);
  process.exit(1);
}

const mb = (size / 1024 / 1024).toFixed(2);
console.log(`✔ النسخة جاهزة: ${outFile} (${mb} م.ب، ${lineCount} سطر، تحوي accounts)`);

// حذف النسخ الأقدم من آخر KEEP
const files = readdirSync(BACKUP_DIR)
  .filter((f) => f.startsWith(`${DB_NAME}_`) && f.endsWith('.sql'))
  .sort()
  .reverse();

const stale = files.slice(KEEP);
for (const f of stale) {
  unlinkSync(join(BACKUP_DIR, f));
  console.log(`🗑  حُذفت نسخة قديمة: ${f}`);
}

console.log(`\nالاستعادة عند الحاجة:`);
console.log(`  npx wrangler d1 execute ${DB_NAME} --remote --file="${outFile}"`);
console.log(`  ⚠️ الاستعادة تكتب فوق البيانات الحية — تأكّد من الملف قبل تشغيلها.`);

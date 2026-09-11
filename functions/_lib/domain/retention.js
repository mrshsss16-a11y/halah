// تقليم السجلات التشغيلية القديمة (٣.٣). بلا هذا، `error_log` و`webhook_log`
// يكبران بلا حد ويُبطئان أي استعلام أدمن عليهما؛ `ig_processed_events` نافذة
// إعادة محاولة ميتا عليه ٣٦ ساعة فقط (migrations/0017) فبقاء صف أقدم من ٤٨
// ساعة زينة لا فائدة تشخيصية أو منع تكرار.
//
// ملاحظة نطاق: `merchantPurge.js` يوثّق أن `error_log` لا يُمحى مع بيانات
// التاجر لأنه «يُقلَّم بدورة حياته الخاصة» — هذا الملف هو تلك الدورة، مناداً
// من `api/cron/healthcheck.js` كل تِك.
//
// دفعات محدودة (LIMIT عبر subquery على rowid — محمول على أي بناء SQLite، لا
// يعتمد على DELETE...LIMIT المباشر) لا حذف جماعي دفعة واحدة: جدول متراكم
// لأشهر يقفل الكتابة لثوانٍ لو حُذف كله بضربة واحدة على D1.
import { logError } from "../core/errorLog.js";

const BATCH_LIMIT = 500;

const TARGETS = [
  { table: "error_log", column: "created_at", cutoffSql: "datetime('now', '-90 days')" },
  { table: "webhook_log", column: "received_at", cutoffSql: "datetime('now', '-90 days')" },
  { table: "ig_processed_events", column: "created_at", cutoffSql: "datetime('now', '-48 hours')" }
];

async function pruneTable(db, { table, column, cutoffSql }) {
  const res = await db
    .prepare(
      `DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${column} < ${cutoffSql} LIMIT ${BATCH_LIMIT})`
    )
    .run();
  return res?.meta?.changes ?? 0;
}

/**
 * يحذف دفعة واحدة (≤٥٠٠ صف لكل جدول) من الصفوف المنتهية الصلاحية عبر
 * الجداول الثلاثة أعلاه. fail-soft لكل جدول على حدة: فشل جدول واحد (مثلاً
 * `ig_processed_events` ببيئة لم تُطبَّق عليها الهجرة ٠٠١٧ بعد) لا يمنع
 * تقليم البقية، ويُسجَّل بدل أن يُبتلع صامتاً (Q2).
 */
export async function pruneOldLogs(env, context = null) {
  if (!env?.DB) return { ran: false };

  const result = { ran: true, failed: [] };
  for (const target of TARGETS) {
    try {
      result[target.table] = await pruneTable(env.DB, target);
    } catch (err) {
      result[target.table] = null;
      result.failed.push(target.table);
      logError(context, {
        requestId: null,
        path: "cron/retention",
        code: "RETENTION_PRUNE_FAILED",
        internal: `table=${target.table} ${String(err?.message || err)}`.slice(0, 250)
      });
    }
  }
  return result;
}

// نبض الـcron (O2، migrations/0027_cron_heartbeat.sql). كل وظيفة cron
// (reminders/healthcheck/bulk_process) تستدعي recordHeartbeat مرة بنهاية
// تشغيلها — نجاحاً أو فشلاً — فيقرأها /api/health ويكشف توقف cron-worker
// بغياب أو تقادم النبض، لا بانتظار شكوى تاجر.
//
// fail-closed على منطق العمل، لكن الكتابة نفسها fire-and-forget: فشل تسجيل
// النبض (مثلاً الجدول لم تُطبَّق هجرته بعد) يجب ألا يُسقط استجابة الـcron
// الذي استدعاه — health.js يتعامل مع الجدول المفقود كـ"missing" لا كخطأ.
export async function recordHeartbeat(env, { job, ok, note = null }) {
  if (!env || !env.DB || !job) return;
  try {
    await env.DB.prepare(
      `INSERT INTO cron_heartbeat (job, last_run_at, last_ok, note)
       VALUES (?, datetime('now'), ?, ?)
       ON CONFLICT (job) DO UPDATE SET
         last_run_at = excluded.last_run_at,
         last_ok = excluded.last_ok,
         note = excluded.note`
    )
      .bind(job, ok ? 1 : 0, note ? String(note).slice(0, 500) : null)
      .run();
  } catch {
    // الجدول قد لا يكون مطبَّقاً بعد (هذه الهجرة تُطبَّق يدوياً لاحقاً) — لا
    // نُسقط استجابة الـcron لأجل هذا وحده.
  }
}

// يقرأها health.js. لا يرمي أبداً — غياب الجدول أو DB يرجّع null فقط.
export async function readHeartbeats(env) {
  if (!env || !env.DB) return null;
  try {
    const { results } = await env.DB.prepare(
      "SELECT job, last_run_at, last_ok, note FROM cron_heartbeat"
    ).all();
    return results || [];
  } catch {
    return null; // الجدول غير موجود بعد، أو خطأ آخر — كلاهما "missing" لا "error"
  }
}

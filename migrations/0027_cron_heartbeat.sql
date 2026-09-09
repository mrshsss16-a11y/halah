-- نبض الـcron (2026-09-09، دفعة د-O2): تتبع آخر تشغيل لكل وظيفة cron ونجاحها،
-- ليقرأه /api/health ويكتشف توقف cron-worker (الذي لا يظهر أي عرض عليه بالخارج
-- إلا بغياب النبض) بدل الاعتماد على ملاحظة تاجر لتأخر تذكير أو نشر.
CREATE TABLE IF NOT EXISTS cron_heartbeat (
  job TEXT PRIMARY KEY,
  last_run_at TEXT,
  last_ok INTEGER,
  note TEXT
);

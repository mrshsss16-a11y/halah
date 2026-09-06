-- D3 (docs/PARALLEL_TRACKS.md §أ.٤): مصرف D1 لسجل الأخطاء + /api/admin/errors.
-- كان console-only فقط (errorLog.js) — يبقى الوسيط الوحيد إلى هذا الجدول، لا
-- كتابة مباشرة من أي مكان آخر، حتى تبقى قاعدة "بلا PII" مفروضة بمكان واحد.
CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  path TEXT NOT NULL,
  code TEXT NOT NULL,
  store_id TEXT,
  internal TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- الاستعلام الأساسي: آخر N خطأ، الأحدث أولاً.
CREATE INDEX IF NOT EXISTS idx_error_log_created ON error_log (created_at DESC);
-- عزل: أخطاء متجر واحد لفريق الدعم بلا مسح الجدول كامل.
CREATE INDEX IF NOT EXISTS idx_error_log_store ON error_log (store_id, created_at DESC);

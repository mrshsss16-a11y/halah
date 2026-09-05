-- B3: bulk product-description generation + publish. Salla's real binding
-- limit is 1 request/second (leak limit, all plan tiers — see
-- .claude/skills/salla-integration/SKILL.md) so a 1000-row job cannot run
-- inside one HTTP request; it's processed a few items per cron tick
-- (functions/api/cron/bulk_process.js) with resumable per-item state here.
CREATE TABLE IF NOT EXISTS bulk_jobs (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'cancelled')),
  tone TEXT NOT NULL DEFAULT 'white',
  total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  succeeded INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bulk_jobs_status ON bulk_jobs (status, updated_at);

CREATE TABLE IF NOT EXISTS bulk_job_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  price TEXT,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed', 'skipped')),
  description TEXT,
  error TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bulk_job_items_pending ON bulk_job_items (job_id, status);

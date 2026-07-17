-- Daily free-tier usage metering + store logo storage for the image studio.
-- day is a UTC date string ("YYYY-MM-DD") so the free allowance resets at
-- 00:00 UTC without needing a scheduled job.

CREATE TABLE IF NOT EXISTS usage_meter (
  merchant_id TEXT NOT NULL,
  day TEXT NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (merchant_id, day)
);

CREATE TABLE IF NOT EXISTS store_logos (
  merchant_id TEXT PRIMARY KEY,
  logo_data_url TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

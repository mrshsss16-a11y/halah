-- Monthly free-tier quota per merchant, replacing the old daily-flat-credit
-- design in usage_meter (functions/_lib/core/meter.js DAILY_LIMIT).
--
-- Why this exists: the daily design gave every merchant an independent
-- 50-credit/day allowance with no relation to the actual shared resource
-- behind it — a single merchant maxing 50 product descriptions in one day
-- (50 x ~250 neurons = 12,500) exceeds Cloudflare Workers AI's entire
-- 10,000-neuron/day free pool for the WHOLE account by itself. Verified
-- against Cloudflare/Groq/OpenRouter's real 2026 free-tier limits
-- (docs/ROADMAP.md m2.2.5, 2026-08-07): combined free capacity across all
-- three tiers is roughly 130-180 AI calls/day for the entire project, shared
-- by every merchant — not per merchant.
--
-- period is "YYYY-MM" so the allowance resets on the 1st of each month
-- without a scheduled job (same no-cron trick as the old "day" column).
-- bucket separates the two independently-priced quotas from
-- docs/ROADMAP.md m2.2.5: descriptions (60/mo) and AI messages (300/mo).

CREATE TABLE IF NOT EXISTS usage_quota (
  merchant_id TEXT NOT NULL,
  period TEXT NOT NULL,
  bucket TEXT NOT NULL CHECK (bucket IN ('description', 'message')),
  used INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (merchant_id, period, bucket)
);

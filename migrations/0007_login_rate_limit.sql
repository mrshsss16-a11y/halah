-- Login brute-force protection: no lockout existed before this, so an
-- attacker could try unlimited password guesses against any known email.
-- 5 failed attempts locks that email out for 15 minutes.
CREATE TABLE IF NOT EXISTS login_attempts (
  email TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

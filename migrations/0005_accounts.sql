-- Real email/password accounts, one per merchant. merchants.id stays the
-- canonical identity used everywhere else (chat memory, usage_meter, product
-- sync...); accounts is just an auth method attached to it.
CREATE TABLE IF NOT EXISTS accounts (
  merchant_id TEXT PRIMARY KEY REFERENCES merchants(id),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts (email);

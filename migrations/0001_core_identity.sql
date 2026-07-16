-- Core identity layer for real Salla/Trendyol integration.
-- merchants.id is the canonical storeId used across chat memory (Vectorize
-- metadata filter), marketing context, and platform connections.

CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  salla_merchant_id TEXT UNIQUE,
  trendyol_seller_id TEXT UNIQUE,
  store_name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  merchant_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('salla')),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  -- Refresh mutex: Salla refresh tokens are single-use; concurrent refreshes
  -- revoke the authorization entirely and force app re-install.
  refresh_lock INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (merchant_id, platform)
);

CREATE TABLE IF NOT EXISTS webhook_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  event TEXT,
  merchant_id TEXT,
  payload TEXT,
  signature_ok INTEGER NOT NULL DEFAULT 0,
  received_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS abandoned_carts (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  items_json TEXT,
  total REAL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'recovered', 'expired')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Platform API-key connections (Trendyol now; extensible). Replaces legacy
-- store_connections whose INTEGER user_id FK is incompatible with TEXT
-- merchant ids. Legacy tables (users, store_connections, synced_products,
-- merchant_marketing_contexts, faqs, store_documents) are untouched here and
-- scheduled for export+drop in phase 5.
CREATE TABLE IF NOT EXISTS platform_connections (
  merchant_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('trendyol')),
  seller_id TEXT NOT NULL,
  api_key TEXT NOT NULL,
  api_secret TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'prod' CHECK (environment IN ('prod', 'stage')),
  store_name TEXT,
  connected_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (merchant_id, platform)
);

CREATE TABLE IF NOT EXISTS marketing_contexts (
  merchant_id TEXT PRIMARY KEY,
  dialect TEXT DEFAULT 'saudi_najdi',
  instructions TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_sync (
  merchant_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,          -- salla product id / trendyol barcode
  title TEXT,
  price REAL,
  stock INTEGER,
  batch_request_id TEXT,              -- trendyol async batch tracking
  sync_status TEXT DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'error')),
  payload_hash TEXT,                  -- trendyol 15-min duplicate-request guard
  last_sync_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (merchant_id, platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_log_merchant ON webhook_log (merchant_id, received_at);
CREATE INDEX IF NOT EXISTS idx_abandoned_carts_merchant ON abandoned_carts (merchant_id, status);

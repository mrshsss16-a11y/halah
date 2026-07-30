-- Migration 0010: Create missing tables and views to complete D1 database schema.
-- Covers: hala_cache, merchant_faqs, merchants_meta, omnichannel_sessions, password_resets, pending_retargeting, wa_messages.

-- 1. hala_cache: Response time cache stats for AI gateway & system analytics
CREATE TABLE IF NOT EXISTS hala_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key TEXT UNIQUE NOT NULL,
  cache_value TEXT,
  response_time_ms INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_hala_cache_key ON hala_cache (cache_key);

-- 2. merchant_faqs: Store-level FAQ items for merchant customer service
CREATE TABLE IF NOT EXISTS merchant_faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_merchant_faqs_merchant ON merchant_faqs (merchant_id);

-- 3. merchants_meta: Merchant metadata key-value storage (e.g. discount_config)
CREATE TABLE IF NOT EXISTS merchants_meta (
  merchant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (merchant_id, key)
);
CREATE INDEX IF NOT EXISTS idx_merchants_meta_merchant ON merchants_meta (merchant_id);

-- 4. omnichannel_sessions: Omnichannel customer sessions across web chat and WhatsApp
CREATE TABLE IF NOT EXISTS omnichannel_sessions (
  session_token TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  phone TEXT,
  name TEXT,
  last_product TEXT,
  chat_summary TEXT,
  theme_category TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_omnichannel_sessions_merchant ON omnichannel_sessions (merchant_id);
CREATE INDEX IF NOT EXISTS idx_omnichannel_sessions_phone ON omnichannel_sessions (phone);

-- 5. password_resets: Secure OTP and token-based password reset requests
CREATE TABLE IF NOT EXISTS password_resets (
  email TEXT PRIMARY KEY,
  otp_code TEXT NOT NULL,
  reset_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets (reset_token);

-- 6. pending_retargeting: Scheduled WhatsApp retargeting messages for abandoned carts & events
CREATE TABLE IF NOT EXISTS pending_retargeting (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  product_id TEXT,
  event_type TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pending_retargeting_merchant_status ON pending_retargeting (merchant_id, status, scheduled_for);

-- 7. wa_messages: View alias mapping to whatsapp_messages for backward compatibility & queries
CREATE VIEW IF NOT EXISTS wa_messages AS SELECT * FROM whatsapp_messages;

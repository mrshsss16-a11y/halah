-- Anti-repetition memory for product copy + WhatsApp Business integration state.

-- Recent generated descriptions per merchant, so the next generation can be
-- told what NOT to repeat (opening lines, phrasings).
CREATE TABLE IF NOT EXISTS copy_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id TEXT NOT NULL,
  product_name TEXT,
  opening TEXT,            -- first ~60 chars of the description (repetition signal)
  keywords TEXT,           -- comma-separated SEO keywords used
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_copy_history_merchant ON copy_history (merchant_id, created_at);

-- WhatsApp contacts + the 24h customer-service window state per phone.
CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  merchant_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  name TEXT,
  last_inbound_at TEXT,    -- ISO; window is open for 24h after this
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (merchant_id, phone)
);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id TEXT,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT,
  wa_message_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wa_messages_phone ON whatsapp_messages (phone, created_at);

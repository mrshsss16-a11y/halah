-- Per-merchant WhatsApp connections. Until now the whole platform shared ONE
-- number via env.WHATSAPP_TOKEN / env.WHATSAPP_PHONE_ID, so every merchant's
-- customers would have received messages from Aura's line — a WhatsApp policy
-- violation (one number messaging many businesses' customers) that gets the
-- number banned and takes every merchant down with it.
--
-- phone_number_id is the routing key: inbound webhooks carry it in
-- entry[].changes[].value.metadata.phone_number_id, which is how we tell whose
-- message just arrived.
CREATE TABLE IF NOT EXISTS wa_connections (
  merchant_id TEXT PRIMARY KEY,
  waba_id TEXT NOT NULL,
  phone_number_id TEXT NOT NULL UNIQUE,
  business_token TEXT NOT NULL,
  display_phone TEXT,
  verified_name TEXT,
  -- 'active' once webhooks are subscribed; 'revoked' when the merchant
  -- disconnects from their side (account_update PARTNER_REMOVED webhook).
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  connected_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wa_connections_phone ON wa_connections (phone_number_id, status);

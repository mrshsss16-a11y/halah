PRAGMA foreign_keys = ON;

-- Knowledge is tenant-scoped by default. Global style entries use organization_id = NULL
-- and must never contain store facts, prices, policies, or customer data.
CREATE TABLE IF NOT EXISTS knowledge_items (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT,
  store_connection_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('style', 'policy', 'faq', 'product', 'safety_rule')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'active', 'retired')),
  title TEXT NOT NULL,
  canonical_text TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  effective_from TEXT,
  effective_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (store_connection_id) REFERENCES store_connections(id),
  CHECK ((kind = 'style' AND organization_id IS NULL AND store_connection_id IS NULL)
    OR (kind <> 'style' AND organization_id IS NOT NULL AND store_connection_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS knowledge_vectors (
  id TEXT PRIMARY KEY NOT NULL,
  knowledge_item_id TEXT NOT NULL,
  organization_id TEXT,
  store_connection_id TEXT,
  vector_namespace TEXT NOT NULL,
  vector_id TEXT NOT NULL UNIQUE,
  embedding_model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (knowledge_item_id) REFERENCES knowledge_items(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (store_connection_id) REFERENCES store_connections(id),
  CHECK ((organization_id IS NULL AND store_connection_id IS NULL)
    OR (organization_id IS NOT NULL AND store_connection_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS customer_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  store_connection_id TEXT NOT NULL,
  external_customer_id TEXT,
  contact_hash TEXT,
  visitor_key_hash TEXT,
  display_name TEXT,
  consent_status TEXT NOT NULL CHECK (consent_status IN ('unknown', 'granted', 'withdrawn')) DEFAULT 'unknown',
  status TEXT NOT NULL CHECK (status IN ('active', 'blocked', 'deleted')) DEFAULT 'active',
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (store_connection_id) REFERENCES store_connections(id),
  CHECK (external_customer_id IS NOT NULL OR contact_hash IS NOT NULL OR visitor_key_hash IS NOT NULL),
  UNIQUE (organization_id, store_connection_id, external_customer_id),
  UNIQUE (organization_id, store_connection_id, contact_hash),
  UNIQUE (organization_id, store_connection_id, visitor_key_hash)
);

CREATE TABLE IF NOT EXISTS conversation_threads (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  store_connection_id TEXT NOT NULL,
  customer_profile_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('web', 'salla', 'whatsapp')),
  status TEXT NOT NULL CHECK (status IN ('active', 'closed', 'escalated')) DEFAULT 'active',
  memory_consent TEXT NOT NULL CHECK (memory_consent IN ('unknown', 'granted', 'withdrawn')) DEFAULT 'unknown',
  summary_ciphertext TEXT,
  summary_key_version INTEGER,
  last_message_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (store_connection_id) REFERENCES store_connections(id),
  FOREIGN KEY (customer_profile_id) REFERENCES customer_profiles(id)
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  store_connection_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  customer_profile_id TEXT NOT NULL,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('customer', 'assistant', 'operator', 'system')),
  body_ciphertext TEXT NOT NULL,
  body_key_version INTEGER NOT NULL,
  redacted_text TEXT,
  source_message_id TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (store_connection_id) REFERENCES store_connections(id),
  FOREIGN KEY (conversation_id) REFERENCES conversation_threads(id),
  FOREIGN KEY (customer_profile_id) REFERENCES customer_profiles(id),
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS customer_memory_facts (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  store_connection_id TEXT NOT NULL,
  customer_profile_id TEXT NOT NULL,
  fact_type TEXT NOT NULL CHECK (fact_type IN ('preference', 'intent', 'consent', 'cart_context', 'support_context')),
  fact_ciphertext TEXT NOT NULL,
  fact_key_version INTEGER NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('explicit', 'confirmed', 'inferred')),
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  source_conversation_id TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (store_connection_id) REFERENCES store_connections(id),
  FOREIGN KEY (customer_profile_id) REFERENCES customer_profiles(id),
  FOREIGN KEY (source_conversation_id) REFERENCES conversation_threads(id)
);

CREATE TABLE IF NOT EXISTS customer_cart_context (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  store_connection_id TEXT NOT NULL,
  customer_profile_id TEXT NOT NULL,
  external_cart_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'abandoned', 'purchased', 'expired', 'unknown')),
  cart_snapshot_ciphertext TEXT NOT NULL,
  cart_key_version INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (store_connection_id) REFERENCES store_connections(id),
  FOREIGN KEY (customer_profile_id) REFERENCES customer_profiles(id),
  UNIQUE (organization_id, store_connection_id, external_cart_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_scope_status
  ON knowledge_items (organization_id, store_connection_id, status, kind, effective_from, effective_until);
CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_scope
  ON knowledge_vectors (organization_id, store_connection_id, vector_namespace);
CREATE INDEX IF NOT EXISTS idx_customer_profiles_scope
  ON customer_profiles (organization_id, store_connection_id, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_conversation_customer
  ON conversation_threads (organization_id, store_connection_id, customer_profile_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON conversation_messages (organization_id, store_connection_id, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_customer
  ON customer_memory_facts (organization_id, store_connection_id, customer_profile_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_cart_customer
  ON customer_cart_context (organization_id, store_connection_id, customer_profile_id, updated_at);

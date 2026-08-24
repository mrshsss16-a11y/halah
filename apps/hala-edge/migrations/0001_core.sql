PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_members (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'operator', 'viewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS store_connections (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('salla', 'zid')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'revoked', 'failed')),
  credential_key_version INTEGER NOT NULL CHECK (credential_key_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, provider),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE IF NOT EXISTS webhook_inbox (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('salla', 'zid', 'whatsapp')),
  external_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  processing_status TEXT NOT NULL CHECK (processing_status IN ('received', 'processed', 'rejected', 'failed')),
  UNIQUE (provider, external_event_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE IF NOT EXISTS policy_sources (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'retired')),
  effective_from TEXT NOT NULL,
  effective_until TEXT,
  policy_version INTEGER NOT NULL CHECK (policy_version > 0),
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE IF NOT EXISTS contact_consents (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  contact_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('granted', 'withdrawn')),
  recorded_at TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  UNIQUE (organization_id, contact_hash),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE IF NOT EXISTS contact_suppressions (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  contact_hash TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  UNIQUE (organization_id, contact_hash),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE IF NOT EXISTS recovery_cases (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  external_cart_id TEXT NOT NULL,
  contact_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received', 'qualified', 'scheduled', 'sent', 'suppressed', 'purchased', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 3),
  policy_source_id TEXT,
  policy_version INTEGER,
  reason_code TEXT NOT NULL,
  next_action_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, external_cart_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (policy_source_id) REFERENCES policy_sources(id)
);

CREATE TABLE IF NOT EXISTS recovery_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  recovery_case_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  template_id TEXT NOT NULL,
  message_category TEXT NOT NULL CHECK (message_category IN ('marketing', 'utility', 'service')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'cancelled')),
  provider_message_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  failure_code TEXT,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (recovery_case_id) REFERENCES recovery_cases(id)
);

CREATE TABLE IF NOT EXISTS message_cost_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  recovery_attempt_id TEXT NOT NULL UNIQUE,
  provider_message_id TEXT,
  category TEXT NOT NULL CHECK (category IN ('marketing', 'utility', 'service')),
  country_code TEXT NOT NULL,
  rate_card_version TEXT NOT NULL,
  estimated_cost_minor INTEGER NOT NULL CHECK (estimated_cost_minor >= 0),
  actual_cost_minor INTEGER,
  currency TEXT NOT NULL,
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('queued', 'sent', 'delivered', 'failed', 'cancelled')),
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (recovery_attempt_id) REFERENCES recovery_attempts(id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  reason_code TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_inbox_processing
  ON webhook_inbox (organization_id, processing_status, received_at);
CREATE INDEX IF NOT EXISTS idx_policy_sources_effective
  ON policy_sources (organization_id, status, effective_from, effective_until);
CREATE INDEX IF NOT EXISTS idx_recovery_cases_scheduler
  ON recovery_cases (organization_id, status, next_action_at);
CREATE INDEX IF NOT EXISTS idx_recovery_attempts_case
  ON recovery_attempts (recovery_case_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_consents_eligibility
  ON contact_consents (organization_id, contact_hash, status);
CREATE INDEX IF NOT EXISTS idx_contact_suppressions_eligibility
  ON contact_suppressions (organization_id, contact_hash);
CREATE INDEX IF NOT EXISTS idx_message_cost_ledger_reporting
  ON message_cost_ledger (organization_id, delivered_at, category);
CREATE INDEX IF NOT EXISTS idx_audit_events_organization
  ON audit_events (organization_id, created_at);

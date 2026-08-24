CREATE TABLE salla_oauth_states (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE INDEX idx_salla_oauth_states_expiry
  ON salla_oauth_states (expires_at, consumed_at);

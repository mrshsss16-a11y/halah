PRAGMA foreign_keys = OFF;

CREATE TABLE store_connections_next (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('salla', 'zid')),
  status TEXT NOT NULL CHECK (
    status IN (
      'pending',
      'authorizing',
      'active',
      'reauthorization_required',
      'revoked',
      'failed'
    )
  ),
  credential_key_version INTEGER NOT NULL CHECK (credential_key_version > 0),
  external_store_id TEXT,
  authorization_scope TEXT,
  authorization_expires_at TEXT,
  connected_at TEXT,
  last_webhook_received_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, provider),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

INSERT INTO store_connections_next (
  id,
  organization_id,
  provider,
  status,
  credential_key_version,
  created_at,
  updated_at
)
SELECT
  id,
  organization_id,
  provider,
  status,
  credential_key_version,
  created_at,
  updated_at
FROM store_connections;

DROP TABLE store_connections;
ALTER TABLE store_connections_next RENAME TO store_connections;

CREATE UNIQUE INDEX idx_store_connections_provider_external_store
  ON store_connections (provider, external_store_id)
  WHERE external_store_id IS NOT NULL;

CREATE INDEX idx_store_connections_organization_status
  ON store_connections (organization_id, provider, status);

PRAGMA foreign_keys = ON;

CREATE TABLE store_connection_credentials (
  connection_id TEXT PRIMARY KEY NOT NULL,
  key_version INTEGER NOT NULL CHECK (key_version > 0),
  encrypted_payload TEXT NOT NULL,
  expires_at TEXT,
  last_refreshed_at TEXT,
  refresh_lease_id TEXT,
  refresh_lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES store_connections(id)
);

CREATE INDEX idx_store_connection_credentials_refresh_lease
  ON store_connection_credentials (refresh_lease_expires_at, connection_id);

CREATE TABLE salla_webhook_inbox (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  request_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  UNIQUE (organization_id, external_event_id)
);

CREATE INDEX idx_salla_webhook_inbox_organization_received
  ON salla_webhook_inbox (organization_id, received_at);

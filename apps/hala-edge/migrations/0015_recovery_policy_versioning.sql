ALTER TABLE policy_sources ADD COLUMN policy_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE policy_sources ADD COLUMN created_by_user_id TEXT;
ALTER TABLE policy_sources ADD COLUMN approved_by_user_id TEXT;
ALTER TABLE policy_sources ADD COLUMN approved_at TEXT;

CREATE UNIQUE INDEX idx_policy_sources_organization_version_unique
  ON policy_sources (organization_id, policy_version);

CREATE INDEX idx_policy_sources_organization_status_version
  ON policy_sources (organization_id, status, policy_version DESC);

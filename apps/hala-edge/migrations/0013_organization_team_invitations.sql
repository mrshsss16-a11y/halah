CREATE TABLE organization_team_invitations (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('operator', 'reviewer', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by_user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (invited_by_user_id) REFERENCES users(id),
  FOREIGN KEY (accepted_by_user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX idx_team_invitations_pending_email
  ON organization_team_invitations (organization_id, email_normalized)
  WHERE status = 'pending';

CREATE INDEX idx_team_invitations_token_status
  ON organization_team_invitations (token_hash, status, expires_at);

CREATE INDEX idx_team_invitations_organization_created
  ON organization_team_invitations (organization_id, created_at DESC);

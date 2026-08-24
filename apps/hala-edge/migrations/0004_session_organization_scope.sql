PRAGMA foreign_keys = ON;

ALTER TABLE user_sessions ADD COLUMN organization_id TEXT;

UPDATE user_sessions
SET organization_id = (
  SELECT m.organization_id
  FROM organization_members AS m
  JOIN organizations AS o ON o.id = m.organization_id
  WHERE m.user_id = user_sessions.user_id
    AND o.status = 'active'
  ORDER BY m.created_at ASC
  LIMIT 1
)
WHERE organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_organization_active
  ON user_sessions (organization_id, expires_at, revoked_at);

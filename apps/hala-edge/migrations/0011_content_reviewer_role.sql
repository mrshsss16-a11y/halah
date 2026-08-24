PRAGMA foreign_keys = OFF;

CREATE TABLE organization_members_next (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'operator', 'reviewer', 'viewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

INSERT INTO organization_members_next (organization_id, user_id, role, created_at)
SELECT organization_id, user_id, role, created_at
FROM organization_members;

DROP TABLE organization_members;
ALTER TABLE organization_members_next RENAME TO organization_members;

CREATE INDEX idx_organization_members_user
  ON organization_members (user_id, organization_id, role);

PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_audit_events_organization_action_created
  ON audit_events (organization_id, action, created_at DESC, id DESC);

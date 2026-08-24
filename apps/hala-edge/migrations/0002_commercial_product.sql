PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id TEXT PRIMARY KEY NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  algorithm TEXT NOT NULL CHECK (algorithm = 'PBKDF2-SHA-256'),
  iterations INTEGER NOT NULL CHECK (iterations >= 100000),
  password_updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activation_requests (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL,
  requested_service TEXT NOT NULL CHECK (requested_service IN ('product_content', 'cart_recovery', 'both')),
  status TEXT NOT NULL CHECK (status IN ('submitted', 'reviewing', 'approved', 'declined', 'cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS product_content_imports (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  record_count INTEGER NOT NULL CHECK (record_count >= 0),
  status TEXT NOT NULL CHECK (status IN ('received', 'validated', 'needs_evidence', 'ready_for_generation', 'failed')),
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS product_fact_sets (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  product_import_id TEXT,
  product_reference TEXT NOT NULL,
  sku TEXT NOT NULL,
  category TEXT NOT NULL,
  facts_json TEXT NOT NULL,
  evidence_status TEXT NOT NULL CHECK (evidence_status IN ('needs_evidence', 'approved')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, sku),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (product_import_id) REFERENCES product_content_imports(id)
);

CREATE TABLE IF NOT EXISTS product_content_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  product_fact_set_id TEXT NOT NULL,
  title TEXT NOT NULL,
  short_description TEXT NOT NULL,
  long_description TEXT NOT NULL,
  meta_description TEXT NOT NULL,
  evidence_map_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'needs_revision', 'approved_for_preview', 'exported_to_staging', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (product_fact_set_id) REFERENCES product_fact_sets(id)
);

CREATE TABLE IF NOT EXISTS product_image_assets (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  product_fact_set_id TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  width_px INTEGER NOT NULL CHECK (width_px > 0),
  height_px INTEGER NOT NULL CHECK (height_px > 0),
  role TEXT NOT NULL CHECK (role IN ('primary', 'detail', 'lifestyle', 'unknown')),
  provenance TEXT NOT NULL CHECK (provenance IN ('merchant_upload', 'store_import', 'generated_or_edited_unknown')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (product_fact_set_id) REFERENCES product_fact_sets(id)
);

CREATE TABLE IF NOT EXISTS vision_observations (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  product_image_asset_id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'reviewed', 'needs_evidence', 'rejected')),
  model_profile_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (product_image_asset_id) REFERENCES product_image_assets(id)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_active
  ON user_sessions (user_id, expires_at, revoked_at);
CREATE INDEX IF NOT EXISTS idx_activation_requests_organization
  ON activation_requests (organization_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_product_content_imports_organization
  ON product_content_imports (organization_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_product_content_drafts_organization
  ON product_content_drafts (organization_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_product_image_assets_fact_set
  ON product_image_assets (product_fact_set_id, role);

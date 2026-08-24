PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS product_content_export_stages (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('csv_review')),
  status TEXT NOT NULL CHECK (status IN ('staged')),
  item_count INTEGER NOT NULL CHECK (item_count BETWEEN 1 AND 200),
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS product_content_export_stage_items (
  export_stage_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_reference TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (export_stage_id, draft_id),
  FOREIGN KEY (export_stage_id) REFERENCES product_content_export_stages(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (draft_id) REFERENCES product_content_drafts(id)
);

CREATE INDEX IF NOT EXISTS idx_product_content_export_stages_organization
  ON product_content_export_stages (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_content_export_stage_items_organization
  ON product_content_export_stage_items (organization_id, draft_id);

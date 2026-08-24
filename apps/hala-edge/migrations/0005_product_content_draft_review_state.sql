PRAGMA foreign_keys = OFF;

CREATE TABLE product_content_drafts_next (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  product_fact_set_id TEXT NOT NULL,
  title TEXT NOT NULL,
  short_description TEXT NOT NULL,
  long_description TEXT NOT NULL,
  meta_description TEXT NOT NULL,
  evidence_map_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'draft',
      'needs_revision',
      'ready_for_review',
      'approved_for_preview',
      'exported_to_staging',
      'rejected'
    )
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (product_fact_set_id) REFERENCES product_fact_sets(id)
);

INSERT INTO product_content_drafts_next (
  id,
  organization_id,
  product_fact_set_id,
  title,
  short_description,
  long_description,
  meta_description,
  evidence_map_json,
  status,
  created_at,
  updated_at
)
SELECT
  id,
  organization_id,
  product_fact_set_id,
  title,
  short_description,
  long_description,
  meta_description,
  evidence_map_json,
  status,
  created_at,
  updated_at
FROM product_content_drafts;

DROP TABLE product_content_drafts;
ALTER TABLE product_content_drafts_next RENAME TO product_content_drafts;

CREATE INDEX IF NOT EXISTS idx_product_content_drafts_organization
  ON product_content_drafts (organization_id, status, updated_at);

PRAGMA foreign_keys = ON;

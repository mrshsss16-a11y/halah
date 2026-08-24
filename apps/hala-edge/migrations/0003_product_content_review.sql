PRAGMA foreign_keys = ON;

ALTER TABLE product_fact_sets ADD COLUMN evidence_reviewed_by_user_id TEXT;
ALTER TABLE product_fact_sets ADD COLUMN evidence_reviewed_at TEXT;
ALTER TABLE product_fact_sets ADD COLUMN evidence_review_note TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_product_fact_sets_review
  ON product_fact_sets (organization_id, evidence_status, product_import_id, updated_at);

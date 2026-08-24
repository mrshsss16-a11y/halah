ALTER TABLE product_content_drafts ADD COLUMN reviewed_by_user_id TEXT;
ALTER TABLE product_content_drafts ADD COLUMN reviewed_at TEXT;
ALTER TABLE product_content_drafts ADD COLUMN review_note TEXT;

CREATE INDEX IF NOT EXISTS idx_product_content_drafts_review_queue
  ON product_content_drafts (organization_id, status, reviewed_at);

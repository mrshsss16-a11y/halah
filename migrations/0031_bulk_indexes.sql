-- فهارس أداء للعمليات الجماعية (WP-A9، 2026-09-17): استعلامات دورة معالجة
-- bulk_job_items (تصفية بـstatus مع job_id) وعرض حالة bulk_jobs بالتاجر
-- (merchant_id مع status) كانت بلا فهرس مطابق تماماً لعمود التصفية الثنائي —
-- فحص جدولي على جدول ينمو مع كل دفعة توليد جماعي. لا تغيير سلوكي، فهارس فقط.
CREATE INDEX IF NOT EXISTS idx_bulk_job_items_status_job ON bulk_job_items (status, job_id);
CREATE INDEX IF NOT EXISTS idx_bulk_jobs_merchant_status ON bulk_jobs (merchant_id, status);

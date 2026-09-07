-- المرحلة ١ من docs/PLAN_BULK_SEO.md — طابور واحد يكتسب نوعاً.
--
-- القرار المعماري: `bulk_jobs` يبقى الطابور الوحيد، ويكتسب عمود `kind` يوجّه
-- به الـcron كل مرحلة لمعالجها. **لا طابور ثانٍ.** القيمة الافتراضية
-- 'seo_generate' تُبقي كل الصفوف القائمة على مسارها الحالي بلا تعديل.
--
-- `cursor` = رقم الصفحة التالية بسلة لوظيفة catalog_sync (صفحة واحدة لكل تِك،
-- لأن تجاوز حد ١/ثانية يوقف اتصال المتجر كاملاً).
-- `locked_until` محجوز لقفل ضد تِك متداخل (يُستعمل بالمرحلة ٢).
--
-- D1 لا يقبل ALTER على CHECK ⇒ لا حالة جديدة بـstatus؛ "بانتظار المراجعة"
-- تُشتق لاحقاً من عدّ review_queue المعلّق.
-- الرقم ٠٠٢٠ لا ٠٠١٩: ٠٠١٨ مأخوذ سابقاً و٠٠١٩ لهجرة الكتالوج.
ALTER TABLE bulk_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'seo_generate';
ALTER TABLE bulk_jobs ADD COLUMN cursor TEXT;
ALTER TABLE bulk_jobs ADD COLUMN locked_until TEXT;

ALTER TABLE bulk_job_items ADD COLUMN seo_payload TEXT;
ALTER TABLE bulk_job_items ADD COLUMN review_id INTEGER;
ALTER TABLE bulk_job_items ADD COLUMN published_at TEXT;

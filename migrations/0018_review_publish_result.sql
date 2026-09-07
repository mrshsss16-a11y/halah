-- نتيجة النشر بعد الاعتماد (docs/INSTAGRAM_PLAN.md §٢.٢).
--
-- لماذا أعمدة منفصلة بدل قلب الحالة: `status` يسجّل **قرار الإنسان** (وافق/رفض)،
-- والنشر حدث لاحق قد يفشل لأسباب خارجة عن القرار (نافذة Meta انتهت، توكن منتهٍ،
-- حد معدل). خلطهما يعني أن فشل شبكة يمحو قرار مراجعة بشرية — وهذا خطأ.
--
-- المخرج المعتمد الذي فشل نشره يبقى `approved` مع خطأ مسجّل، ويُعاد يدوياً.
ALTER TABLE review_queue ADD COLUMN published_at TEXT;
ALTER TABLE review_queue ADD COLUMN publish_error TEXT;
-- معرّف المنشور/الرسالة عند المزوّد — لتتبّع ما وصل فعلاً ومنع نشر مزدوج.
ALTER TABLE review_queue ADD COLUMN external_id TEXT;

-- استعلام "معتمد ولم يُنشر بعد" — إعادة المحاولة اليدوية ولوحة الفريق.
CREATE INDEX IF NOT EXISTS idx_review_queue_unpublished
  ON review_queue (merchant_id, status, published_at);

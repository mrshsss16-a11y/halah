-- سجل معرّفات متجهات Vectorize لكل تاجر (2026-09-11).
--
-- لماذا: Vectorize لا يدعم الحذف بفلتر metadata — `deleteByIds` فقط. وذاكرة
-- التاجر تحمل نصه الخام بـmetadata.text (سؤاله وجوابه، أو ملاحظة كتبها). بلا
-- سجل معرّفات لا توجد طريقة أصلاً لمعرفة ما يجب حذفه عند «احذف بياناتي»، فوعد
-- الحذف النهائي بصفحة الخصوصية كان غير قابل للتنفيذ للذاكرة.
--
-- يُكتب الصف داخل `functions/_lib/ai/vectorStore.js` قبل كتابة المتجه، ويُمحى
-- معه بـ`deleteByIds`. الجدول ضمن PURGE_TABLES فبقاياه تسقط مع بقية بيانات
-- التاجر.
CREATE TABLE IF NOT EXISTS vector_refs (
  merchant_id TEXT NOT NULL,
  vector_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ref_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vector_refs_merchant ON vector_refs(merchant_id);

-- المرحلة ٤ (docs/COMPLETION_PATH.md 4.5) — متابعة الإطلاق المحدود.
--
-- last_active_at على merchants لا accounts: تاجر سلة Easy-Mode بلا صف accounts
-- إطلاقاً، ومع ذلك "نشط". يُحدَّث بخنق KV (١٠ دقائق) عند أي طلب بجلسة — لا كتابة
-- لكل طلب. مؤشر ٩٠ يوماً بـROADMAP ("٣٠٪ يستخدمون أسبوعياً") يُقاس منه لا من التخمين.
ALTER TABLE merchants ADD COLUMN last_active_at TEXT;

-- تغذية راجعة صريحة من التاجر (سؤال واحد بالداشبورد): درجة ١-٥ + نص حر اختياري.
-- merchant_id إلزامي — العزل شرط بنيوي. لا PII غير ما يكتبه التاجر بنفسه.
CREATE TABLE IF NOT EXISTS merchant_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  context TEXT,                 -- من أي شاشة جاء (studio/review/store…)
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_merchant_feedback_merchant ON merchant_feedback (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_merchant_feedback_created ON merchant_feedback (created_at DESC);

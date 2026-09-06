-- B7: بوابة المراجعة البشرية (review_queue).
-- المبدأ الحاكم بالمشروع: الذكاء الاصطناعي يقترح، والإنسان يقرر. لا مخرج AI
-- (تقرير، رد تعليق، صورة، وصف منتج) يصل عميلاً أو منصة عامة قبل اعتماد بشري.
-- هذا الجدول هو نقطة الاختناق الوحيدة لذلك القرار.
--
-- merchant_id إلزامي (NOT NULL) — العزل شرط بنيوي لا اختياري: صف بلا متجر
-- يعني مخرجاً بلا مالك، وهذا بحد ذاته تسريب محتمل بين التجار.
CREATE TABLE IF NOT EXISTS review_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('report', 'social_reply', 'image', 'description')),
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  -- سبب الرفض (اختياري) — يُكتب بيد المراجِع البشري، لا يُولَّد آلياً.
  review_note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- الاستعلام الأساسي: المعلّق لمتجر واحد، الأقدم أولاً (طابور عادل: أول ما دخل
-- أول ما يُراجَع). المتصدِّر merchant_id لأن كل استعلام معزول به بلا استثناء.
CREATE INDEX IF NOT EXISTS idx_review_queue_pending
  ON review_queue (merchant_id, status, created_at);

-- عرض تاريخ المراجعة لمتجر واحد (الأحدث أولاً) بلا مسح الجدول كامل.
CREATE INDEX IF NOT EXISTS idx_review_queue_merchant_created
  ON review_queue (merchant_id, created_at DESC);

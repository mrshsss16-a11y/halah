-- المرحلة ١ من docs/PLAN_BULK_SEO.md — سحب كتالوج المتجر من سلة إلى D1.
--
-- لماذا جدول محلي بدل القراءة الحيّة من سلة: حد سلة الحقيقي ١ طلب/ثانية لكل
-- متجر، وتجاوزه يوقف اتصال المتجر **كاملاً** لا الطلب وحده. أي ميزة تقرأ
-- الكتالوج (أولوية الحصة، بناء بصمة المتجر، شاشة المراجعة) تصير صفر طلبات سلة
-- بعد السحب الأول.
--
-- `current_description` = الوصف الأصلي كما هو بسلة قبل أي كتابة من هالة.
-- بدونه، `PUT /products/sku/{sku}` (يستبدل لا يدمج) يجعل أول خطأ جماعي غير
-- قابل للإصلاح — هذا العمود هو ما يجعل "التراجع" ممكناً (المخاطرة ٤ بالخطة).
--
-- الرقم ٠٠١٩ لا ٠٠١٨: الرقم ٠٠١٨ مأخوذ فعلاً بـ0018_review_publish_result.sql.
CREATE TABLE IF NOT EXISTS store_products (
  merchant_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  salla_product_id TEXT,
  name TEXT NOT NULL,
  price TEXT,
  category TEXT,
  current_description TEXT,
  image_url TEXT,
  synced_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (merchant_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_store_products_merchant ON store_products (merchant_id, category);

CREATE TABLE IF NOT EXISTS store_profiles (
  merchant_id TEXT PRIMARY KEY,
  profile TEXT NOT NULL,   -- JSON: categories/audience/toneNotes/vocabulary/forbidden
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  source_sample INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- migrations/0006_hala_admin.sql
-- Admin layer: disable flag on accounts, Hala's own FAQ knowledge (RAG source
-- of truth), and free-consultation bookings from the Aura WhatsApp line.

ALTER TABLE accounts ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS hala_faq (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS consultation_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  phone TEXT NOT NULL,
  preferred_slot_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_consultation_bookings_status ON consultation_bookings (status, created_at);

-- Seed from persona/hala-support-knowledge.md — keep both in sync by hand.
INSERT INTO hala_faq (question, answer) VALUES
  ('وش تسوي هالة بالضبط؟', 'هالة ذكاء اصطناعي سعودي يخدم أصحاب المتاجر الإلكترونية: يفحص المتجر مجاناً ويكتشف خسائره خلال ٣٠ ثانية، يكتب أوصاف منتجات احترافية بلهجة سعودية، يحسّن صور المنتجات، ويرد على عملاء المتجر تلقائياً ويسترد السلات المتروكة عبر واتساب.'),
  ('كم سعر هالة؟', 'تجربة مجانية ٣٠ يوم: ٢٠٠ وصف منتج + ٤٠٠ صورة استوديو + ٥٠ رسالة واتساب، بدون بطاقة ائتمان. ما فيه سعر شهري منشور بعد التجربة — فريقنا يحدده حسب حجم متجرك مباشرة على واتساب.'),
  ('كيف أبدأ مع هالة؟', 'تقدر تبدأ بفحص متجرك المجاني خلال ٣٠ ثانية من الصفحة الرئيسية، أو تتواصل معنا مباشرة على واتساب ونساعدك خطوة بخطوة.'),
  ('هالة يشتغل مع أي منصات؟', 'هالة يتكامل مع سلة و Trendyol حالياً، ودعم منصة زد قادم قريباً.'),
  ('هل أحتاج بطاقة ائتمان للتجربة؟', 'لا، التجربة المجانية ٣٠ يوم بدون بطاقة ائتمان إطلاقاً. الفحص الأولي للمتجر مجاني دائماً حتى بعد انتهاء التجربة.'),
  ('هل أقدر أحجز استشارة مجانية؟', 'أكيد، أقدر أحدد لك موعد استشارة مجانية مع فريق هالة — قولي الوقت المناسب لك وأرتبه.');

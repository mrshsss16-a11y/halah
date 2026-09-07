-- ربط حسابات إنستغرام بالتجّار (docs/INSTAGRAM_PLAN.md المرحلة ١.٣).
--
-- ig_user_id = entry[].id بحمولة الويبهوك = المفتاح **الوحيد** الذي يربط حدثاً
-- بتاجره. نظيره بواتساب phone_number_id (انظر migrations/0013_wa_connections.sql).
-- UNIQUE عليه: حساب إنستغرام واحد لا يجوز أن يُنسب لتاجرين — وإلا تسرّبت
-- محادثات عملاء بين متجرين (كسر المعيار أ.١).
CREATE TABLE IF NOT EXISTS ig_connections (
  merchant_id TEXT NOT NULL,
  ig_user_id TEXT NOT NULL UNIQUE,
  username TEXT,
  access_token TEXT NOT NULL,          -- long-lived، صالح ٦٠ يوماً
  token_expires_at INTEGER NOT NULL,   -- epoch seconds — يقرأه cron التجديد
  scopes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (merchant_id, ig_user_id)
);

-- مسار الويبهوك الساخن: ig_user_id → merchant_id بكل حدث وارد.
CREATE INDEX IF NOT EXISTS idx_ig_conn_user ON ig_connections (ig_user_id);
-- cron التجديد: التوكنات القاربة على الانتهاء أولاً.
CREATE INDEX IF NOT EXISTS idx_ig_conn_expiry ON ig_connections (token_expires_at);

-- إزالة تكرار أحداث إنستغرام.
-- Meta تعيد المحاولة على مدى ٣٦ ساعة وتجمّع حتى ١٠٠٠ تحديث بالدفعة ⇒ التكرار
-- **مضمون**، لا احتمال. بلا هذا الجدول: ردّان على نفس التعليق، وحصة محروقة مرتين.
CREATE TABLE IF NOT EXISTS ig_processed_events (
  event_id TEXT PRIMARY KEY,           -- value.id للتعليق أو message.mid للرسالة
  merchant_id TEXT NOT NULL,
  kind TEXT NOT NULL,                  -- 'comment' | 'dm'
  created_at TEXT DEFAULT (datetime('now'))
);

-- للتنظيف الدوري (الأحداث الأقدم من ٤٨ ساعة لا قيمة لها — نافذة إعادة المحاولة ٣٦).
CREATE INDEX IF NOT EXISTS idx_ig_events_created ON ig_processed_events (created_at);

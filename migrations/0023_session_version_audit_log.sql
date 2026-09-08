-- المرحلة ٣ (docs/COMPLETION_PATH.md) — بوابة "قبل أول تاجر حقيقي".
--
-- P40 — إبطال الجلسات: الكوكي HMAC بلا حالة، فتغيير كلمة المرور/التعطيل/الخروج لم يكن
-- يطرد نسخة مسروقة ٣٠ يوماً. `session_version` يُضمَّن بحمولة التوقيع ويُزاد عند كل
-- حدث إبطال؛ الجلسات الأقدم تفشل بالتحقق. القيمة ٠ للجميع = كل الجلسات القائمة تبقى
-- صالحة لحظة الهجرة (لا طرد جماعي بالنشر).
ALTER TABLE accounts ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;

-- P38 طبقة ٢ / P41 — ملكية البريد. حسابات Google (`m_g_` — البادئة علامة المزوّد،
-- انظر auth/google.js) بريدها متحقَّق من Google نفسها؛ حسابات كلمة المرور تبقى NULL حتى
-- تمر بتدفق التحقق (auth/send_verification + verify_email). لا بوابة عليها بعد —
-- التفعيل مشروط بمزوّد بريد (قرار المالك)، موثّق بـCOMPLETION_PATH 3.3.
ALTER TABLE accounts ADD COLUMN email_verified_at TEXT;
UPDATE accounts SET email_verified_at = COALESCE(email_verified_at, created_at, datetime('now')) WHERE merchant_id LIKE 'm_g_%';

CREATE TABLE IF NOT EXISTS email_verifications (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- P9 — سطر تدقيق لكل قراءة/كتابة أدمن عابرة للمتاجر: من، ماذا، على أي متجر، متى.
-- لا PII: البريد هو هوية الأدمن (لا بريد عميل)، والهدف merchant_id لا اسم ولا جوال.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  path TEXT NOT NULL,
  target_merchant_id TEXT,
  request_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log (target_merchant_id, created_at DESC);

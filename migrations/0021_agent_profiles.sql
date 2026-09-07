-- شخصية الوكيل وإعداداته لكل تاجر — صف واحد لكل عميل، لا شرط `if` بالكود.
--
-- المشكلة التي يحلها: شخصية الوكيل كانت تُختار بشرط مكتوب بالكود
-- (`if (isAuraLine) HALA_SUPPORT_PROMPT else PERSONA_SYSTEM_PROMPT`). مع ١٠٠
-- عميل يصير ١٠٠ شرط، وأي تعديل شخصية يحتاج نشراً. بعد هذا الجدول: تاجر جديد =
-- صف جديد، صفر كود. وأورا نفسها تصير صفاً عادياً لا حالة خاصة.
--
-- لماذا ليس `store_profiles` (0019): ذاك بصمة أسلوب كتابة **مشتقّة آلياً** من
-- الكتالوج لتوليد أوصاف المنتجات، بدورة مراجعة draft/approved. هذا إعداد
-- **يكتبه التاجر بنفسه** لسلوك المحادثة الحيّة. مالكان مختلفان ودورتا حياة
-- مختلفتان — دمجهما يخلط المشتق بالمُدخَل يدوياً.
--
-- لماذا JSON لبعض الحقول: `knowledge_links` و`appearance` قوائم/كائنات تتوسع
-- (روابط سياسات، ألوان، موضع الزر) بلا هجرة جديدة كل مرة. الحقول التي يُبحث
-- أو يُفلتر بها تبقى أعمدة حقيقية.
CREATE TABLE IF NOT EXISTS agent_profiles (
  merchant_id TEXT PRIMARY KEY,

  -- الهوية: من هو الوكيل ومن يمثّل
  agent_name TEXT NOT NULL DEFAULT 'هالة',
  business_name TEXT,
  business_type TEXT,              -- متجر إلكتروني · عيادة · مطعم · وكالة · أخرى
  city TEXT,
  about TEXT,                      -- نبذة قصيرة يستخدمها الوكيل بالتعريف

  -- الشخصية: كيف يتكلم
  dialect TEXT NOT NULL DEFAULT 'saudi_najdi',   -- saudi_najdi · saudi_hijazi · fusha_friendly
  tone TEXT NOT NULL DEFAULT 'friendly',         -- friendly · formal · concise
  reply_length TEXT NOT NULL DEFAULT 'short',    -- short (سطر-سطرين) · medium · detailed
  emoji_level INTEGER NOT NULL DEFAULT 1,        -- 0 = ممنوع · 1 = إيموجي واحد · 2 = حر
  custom_instructions TEXT,                      -- تعليمات حرة من التاجر

  -- السياسات: ما يُسمح وما يُمنع
  -- allow_prices=0 هو سلوك أورا (توجيه للاستشارة بدل رقم)، =1 لتاجر يعرض أسعاره.
  allow_prices INTEGER NOT NULL DEFAULT 1,
  forbidden_topics TEXT,                         -- سطر لكل موضوع ممنوع
  unknown_answer_policy TEXT,                    -- ماذا يقول حين لا يعرف

  -- التصعيد: متى ولمن
  escalation_number TEXT,
  working_hours TEXT,                            -- نص حر: "الأحد-الخميس ٩ص-٥م"
  after_hours_reply TEXT,

  -- المعرفة والمظهر (JSON قابل للتوسّع)
  knowledge_links TEXT,                          -- JSON: {shipping,returns,privacy,site}
  appearance TEXT,                               -- JSON: {primaryColor,greeting,position,logoUrl}

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- قراءة صورة المنتج المنظّمة لكل متجر (2026-09-12).
--
-- لماذا: نفس التنورة قُرئت «قصّة واسعة» ثم «قصّة مستقيمة» بعد ست دقائق لأن كل توليد يعيد قراءة
-- الصورة، والمزوّد يتغيّر حسب الحصص المجانية. الحقائق المتحقَّقة (قيم من قوائم مغلقة) تُحفظ لكل
-- صورة، فإعادة التوليد تستخدمها ولا تعيد القراءة (functions/_lib/domain/visionFacts.js).
--
-- نص مختصر لما ظهر في الصورة (لون، طول، قصّة، تفاصيل) — لا الصورة نفسها. بيانات تاجر: ضمن
-- PURGE_TABLES، وتُذكر بجدول مدد الاحتفاظ بصفحة الخصوصية.
CREATE TABLE IF NOT EXISTS vision_facts (
  merchant_id TEXT NOT NULL,
  image_key TEXT NOT NULL,
  facts TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (merchant_id, image_key)
);

-- المرحلة ٢ من docs/COMPLETION_PATH.md (خطوات ٥-٩ بـdocs/PLAN_BULK_SEO.md) —
-- "تراجع" حقيقي عن النشر الجماعي.
--
-- المشكلة: `current_description` يُستبدل بكل سحب من سلة. بعد أن تنشر هالة وصفاً،
-- السحب التالي يكتب وصف هالة فوق الأصل، فيضيع الأصل ويستحيل التراجع (المخاطرة
-- ٤ بالخطة). `original_description` يُكتب **مرة واحدة** عند أول سحب (COALESCE
-- بالـupsert في services/catalog.js) ولا يُلمس بعدها إلا بأمر التاجر الصريح.
--
-- `hala_published_at`: آخر مرة كتبت فيها هالة وصف هذا المنتج على سلة — يميّز
-- "الحالي = وصف التاجر الأصلي" عن "الحالي = وصف هالة" بشاشة المراجعة بصدق.
ALTER TABLE store_products ADD COLUMN original_description TEXT;
ALTER TABLE store_products ADD COLUMN hala_published_at TEXT;

-- تعبئة الموجود: كل صف مسحوب قبل هذه الهجرة لم تنشر هالة عليه بالجملة بعد
-- (المسار الجماعي كان ينشر فوراً بلا تتبّع — لكن الوصف الحالي هو أفضل تقريب
-- متاح للأصل). صادق بقدر المعلومة المتوفرة، لا ادعاء أكثر.
UPDATE store_products SET original_description = current_description WHERE original_description IS NULL;

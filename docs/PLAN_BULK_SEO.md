# 📦 خطة: الربط والتحليل والتوليد والنشر دفعة واحدة

> **الطلب الأصلي:** التاجر يربط متجره ← هالة تحلل **كل** منتجاته دفعة واحدة ← تولّد
> أوصافاً وحزم SEO للكل ← يراجع ويوافق جماعياً — **بلا تعديل منتج منتج**.
>
> كُتبت 2026-09-07 · مبنية على فحص الكود الفعلي، لا على التوثيق.

---

## ١. الحقيقة المرّة — "الرفع بالجملة" لا يقرأ من سلة إطلاقاً

`docs/ROADMAP.md` يوثّق B3 كمنجز. **الواقع:** `functions/api/store/bulk/upload.js` يستقبل
**صفوف CSV يلصقها التاجر بيده** (`dashboard.html:199`). `listProducts()` تُستدعى فقط
للعرض بـ`store/overview.js`.

يعني المبني هو: *"بدون تعديل منتج منتج — بشرط أن تكتبهم كلهم بيدك أولاً."*

### ما يعمل فعلاً اليوم

| المكوّن | الملف | الحالة |
|---|---|---|
| طابور دفعات + استئناف | `migrations/0014_bulk_jobs.sql` | ✅ صفوف قابلة للاستئناف |
| إنشاء وظيفة | `store/bulk/upload.js` — سقف ٥٠٠ صف، قصّ على الحصة | ✅ لكن مدخله لصق يدوي |
| تتبّع التقدّم | `store/bulk/status.js` + `dashboard.html:592` | ✅ |
| المعالجة الخلفية | `cron/bulk_process.js` — `BATCH_SIZE=20`, `DELAY_MS=1100` | ✅ يحترم حد سلة |
| محرّك المحتوى | `copy.js` → حزمة SEO كاملة | ✅ مبني بالكامل |
| بوابة المراجعة | `_lib/services/reviewQueue.js` + `0016` | ✅ **مبنية وغير مستدعاة** |
| النشر | `salla.js:updateProductBySku()` | ✅ |

---

## ٢. الفجوات الثلاث الحقيقية

**١. لا سحب كتالوج.** لا endpoint ولا جدول يستورد منتجات المتجر. **الفجوة رقم واحد** — كل
الوعد ينهار عندها.

**٢. مسار الجملة يتجاوز بوابة المراجعة كلياً.** `bulk_process.js` ينشر على سلة **فور
التوليد**. البوابة مبنية والنوع `description` جاهز — ولا أحد يستدعيها. **أوسع مسار
بالمنتج ينتهك مبدأه المعلن** ("الـAI يقترح والإنسان يقرر").

**٣. حزمة SEO تُولَّد كاملة ثم تُرمى.** `copy.js` ينتج `slug` و`metaDescription`
و`focusKeyword` و`jsonLdSchema` و`tags`؛ `bulk_job_items` تخزّن **عمود `description`
وحده**، والنشر يكتبه وحده.

---

## ٣. التصميم — خمس مراحل بطابور واحد

```
ربط سلة (موجود) → webhook app.store.authorize
        │
        ▼
① SYNC — سحب الكتالوج          kind='catalog_sync'
   صفحة/تِك · per_page=60 · ≥1.1s → store_products
        │
        ▼
② PROFILE — بصمة المتجر         kind='store_profile'
   استدعاء AI واحد على عيّنة ≤40 منتج
   → فئات · جمهور · نبرة · مفردات · ممنوعات
   ← يمرّ ببوابة المراجعة (التاجر يعتمد/يعدّل)
        │
        ▼
③ GENERATE — توليد جماعي         kind='seo_generate'
   copy.js + البصمة محقونة · حصة description
   يُخزَّن seo_payload كاملاً
   ← enqueue() ببوابة المراجعة
   ✗ صفر كتابة على سلة هنا
        │
        ▼
④ REVIEW — شاشة واحدة
   جدول: الحالي ← المقترح · [اعتمد الكل] [المحدد] [ارفض]
   تحرير سطري يُحفظ بالـpayload
        │
        ▼
⑤ PUBLISH — نشر تسلسلي           kind='seo_publish'
   المعتمَد فقط · PUT /products/sku/{sku} · ≥1.1s
   فشل صف = صف واحد · استئناف بالتِك التالي
```

**القرار المعماري الحاكم:** طابور واحد (`bulk_jobs`) يكتسب عمود `kind`، ونفس الـcron
يصرّف المراحل بمعالج لكل نوع. **لا طابور ثانٍ.**

### القرار الأصعب — فصل التوليد عن النشر

الطابور الحالي يخلط عمليتين مختلفتي الطبيعة: **نداء AI** (لا علاقة له بسلة، قابل
للتوازي) و**كتابة على سلة** (مقيّدة بـ١/ثانية بعقوبة قطع الاتصال). دمجهما يجعل التوليد
يرث قيد سلة بلا سبب — **٢٠٠ منتج تصير ٣.٤ ساعة بدل دقائق**.

**ثمن الفصل:** الصف يعبر أربع حالات عبر جدولين. **التخفيف:** `review_queue` هي المرجع
الوحيد لحالة المحتوى، و`bulk_job_items.review_id` مؤشر فقط، ولا يُشتق أي قرار نشر من
`bulk_job_items.status`.

---

## ٤. الجداول والنقاط الجديدة

### هجرة `0018_catalog_and_profile.sql`
```sql
CREATE TABLE store_products (
  merchant_id TEXT NOT NULL, sku TEXT NOT NULL,
  salla_product_id TEXT, name TEXT NOT NULL,
  price TEXT, category TEXT, current_description TEXT, image_url TEXT,
  synced_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (merchant_id, sku)
);
CREATE INDEX idx_store_products_merchant ON store_products (merchant_id, category);

CREATE TABLE store_profiles (
  merchant_id TEXT PRIMARY KEY,
  profile TEXT NOT NULL,   -- JSON: categories/audience/toneNotes/vocabulary/forbidden
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  source_sample INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### هجرة `0019_bulk_pipeline.sql`
```sql
ALTER TABLE bulk_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'seo_generate';
ALTER TABLE bulk_jobs ADD COLUMN cursor TEXT;          -- صفحة catalog_sync
ALTER TABLE bulk_jobs ADD COLUMN locked_until TEXT;    -- قفل ضد تِك متداخل
ALTER TABLE bulk_job_items ADD COLUMN seo_payload TEXT;
ALTER TABLE bulk_job_items ADD COLUMN review_id INTEGER;
ALTER TABLE bulk_job_items ADD COLUMN published_at TEXT;
```
> D1 لا يقبل `ALTER` على `CHECK` — **لا نضيف حالة جديدة**؛ "بانتظار المراجعة" تُشتق من
> عدّ `review_queue` المعلّق.

### الخدمات (M1)
- `services/catalog.js` — `syncCatalogPage` · `listCatalog` · `getCatalogItem`
- `services/storeProfile.js` — `buildProfile` · `getProfile` · `approveProfile` · `profileToPromptBlock`
- `services/bulkPipeline.js` — `startCatalogSync` · `startGeneration` · `startPublish` · `jobSummary`

### النقاط (كلها `requireCompletedAccount`)
`store/catalog/sync` · `store/catalog/list` · `store/profile` · `store/bulk/generate` ·
**`store/review/list`** · **`store/review/decide`** · `store/bulk/publish` ·
تعديل `cron/bulk_process` للتوجيه حسب `kind`

> `reviewQueue.js` يحتاج إضافتين فقط: `approveMany` (حلقة فوق `transition`، لا SQL جديد)
> و`updatePayload` مشروطة بـ`status='pending'`. `reviewed_by` من الجلسة لا من العميل.

---

## ٥. اتساق الأسلوب عبر ٢٠٠ منتج — ثلاث طبقات

1. **`store_profile` محقونة بكل استدعاء** — نفس النص حرفياً للـ٢٠٠. **المرساة.**
2. `recallStyleExamples` القائمة (حسب الفئة).
3. `recentCopy()` القائمة — تمنع تكرار الافتتاحيات.
   ⚠️ **تحذير:** تجلب "الأخيرة" فقط؛ عبر ٢٠٠ منتج تنجرف. **ثبّت نافذتها (آخر ٥)**
   وأبقِ المرساة بالطبقة ١.

---

## ٦. الحصة — متجر ٢٠٠ منتج بباقة ٦٠/شهر

السلوك الحالي يقصّ **بصمت**. المقترح:

1. **أظهر الحقيقة قبل البدء:** "متجرك فيه ٢٠٤ منتج. باقتك تغطي ٦٠ هالشهر."
2. **أولوية بدل عشوائية:** بلا وصف إطلاقاً ← وصف < ٨٠ حرفاً ← الأحدث. أعلى عائد SEO من
   الحصة. (يُحسب من `store_products` — صفر طلب سلة.)
3. **الباقي مؤجَّل لا مرفوض:** حالة `skipped` بـ`error='مؤجّل للشهر القادم'`، ويُحيا
   تلقائياً أول تِك بعد تبدّل الشهر. **التاجر لا يعيد شيئاً.**
4. **السحب والبصمة شبه مجانيين:** `catalog_sync` صفر AI · `buildProfile` استدعاء واحد.
5. **نقطة الترقية بمكانها الطبيعي:** "١٤٠ منتج جاهز — رقّي الباقة وتنتهي اليوم بدل ٣ شهور."

---

## ٧. الترتيب التنفيذي

| # | العمل | يعتمد على |
|---|---|---|
| ١ | هجرة `0018` + `services/catalog.js` + `catalog_sync` بالـcron | — |
| ٢ | هجرة `0019` + توجيه `kind` + قفل + حد لكل متجر | ١ |
| ٣ | `services/storeProfile.js` + `/api/store/profile` | ١ |
| ٤ | حقن البصمة بـ`generateProductCopy` + تخزين `seo_payload` | ٢، ٣ |
| **٥** | **فصل النشر عن التوليد** — إزالة `updateProductBySku` من مسار التوليد و`enqueue()` بدلها | ٤ |
| ٦ | `approveMany` + `updatePayload` + `/api/store/review/*` | ٥ |
| ٧ | شاشة المراجعة الجماعية بالداشبورد | ٦ |
| ٨ | `seo_publish` (حقول SEO كاملة لا الوصف وحده) | ٦ |
| ٩ | أولوية الحصة + الإحياء الشهري + نص الترقية | ٤ |

**الخطوة ٥ هي المفصل:** قبلها الميزة تخالف مبدأ المراجعة البشرية، بعدها لا.

---

## ٨. المخاطر

1. **حد سلة ١/ثانية لكل متجر — الأول.** التجاوز يوقف اتصال المتجر **بالكامل**.
   `sleep(1100)` الحالي يقيّد **الخادم لا المتجر** — **ينكسر مع متجرين نشطين بنفس التِك**.
   إلزامي: أصناف متجر واحد لكل تِك، أو فاصل محسوب لكل `merchant_id`. وأضف احترام
   `Retry-After` و`429` بتراجع أسّي — غير موجود اليوم.
2. **مدة التجربة الأولى.** ٢٠٠ منتج نشراً = ٤ دقائق طلبات موزّعة على تِكات ١٠ دقائق.
   **صياغة التوقّع (`etaMinutes` صادق + إشعار) أهم من السرعة.**
3. **انجراف الأسلوب** — يُختبر فعلياً على ٥٠+ منتج قبل الإطلاق.
4. **تدمير أوصاف حقيقية.** `PUT` يستبدل. `current_description` تحفظ الأصل — **يجب إتاحة
   "تراجع"**، وإلا فأول خطأ جماعي غير قابل للإصلاح.
5. **`review_queue.payload` سقفه ٢٠٠٠٠ حرف** — حزمة SEO ~٣-٤ آلاف، آمنة، لكن تحقّق قبل
   حشو JSON-LD موسّع.
6. **إعفاء `tenant-audit-ok` بـ`completeBulkJobItem`** مبرَّر بـ"لا endpoint تاجر
   يستدعيها" — **هذا الافتراض ينكسر** مع نقاط النشر الجديدة. **راجع الإعفاء لا تمدّده.**
7. **SKU مفقود/مكرر.** منتجات سلة بلا SKU تسقط صامتة. يلزم عدّ صريح:
   "١٢ منتج بلا SKU — تعذّر تحديثهم."

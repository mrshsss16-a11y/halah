# هالة (Hala AI OS)

منصة ذكاء اصطناعي لتجار السعودية: مساعدة تسويقية بلهجة سعودية تخدم عملاء المتجر،
تكتب المحتوى، تسترد السلات المتروكة، وتتزامن مع **سلة** و**Trendyol**.

## البنية

كل شي على **Cloudflare** — صفر مفاتيح API خارجية لتوليد النصوص:

| الطبقة | التقنية |
|---|---|
| الاستضافة | Cloudflare Pages (مشروع `hala-ai-os`) |
| الـ API | Pages Functions (`functions/api/*` → `/api/*`) |
| توليد النصوص | Workers AI — `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |
| ذاكرة RAG | Vectorize `halah-tr-faq` (embeddings: `@cf/baai/bge-m3`, عزل لكل متجر بـ metadata `storeId`) |
| قاعدة البيانات | D1 `halah-tr-db` (migrations بـ `migrations/`) |

## خريطة الملفات

```
*.html              صفحات الواجهة — تمر بمعالج #include (انظر partials/) ثم تُنسخ لـ dist/ عبر scripts/stage.mjs
partials/           مكونات مشتركة تُدمج وقت البناء بـ <!--#include partials/x.html -->:
                      fouc-theme.html  سكربت منع وميض الثيم (كان مكرر/متباعد بـ 8 صفحات، الآن مصدر واحد)
                      app-shell.html   السايدبار + هيدر الجوال + الدرج + بانر Sandbox لصفحات dashboard/communication
                      (تفعيل الرابط النشط بجافاسكربت وقت التشغيل حسب اسم الصفحة، مو hardcoded — صفحة جديدة ما تحتاج تعدّل غير data-nav)
style.css theme.js  التنسيق + نظام الثيم الموحد (HalaTheme — لا ثيم مخصص بأي صفحة)
functions/
  _lib/             persona · workersAI · memory (RAG) · db · salla · trendyol · respond · meter (حصص) · imageProvider (klein+HF) · auth (تجزئة كلمة مرور) · session (كوكي موقّع + resolveStoreId)
  api/
    chat.js         شات المسوقة: استرجاع → توليد → نقد ذاتي → تحسين → حارس → حفظ بالذاكرة
    copy.js         كتابة أوصاف منتجات
    image.js        صور منتجات AI حقيقية (klein أساسي، Hugging Face احتياطي) — يحفظ هوية المنتج
    usage.js        رصيد الحصة اليومية المتبقي (يغذي شريط studio.html)
    stats.js        عدد التجار الحقيقي (اجتماعي صادق بصفحة الدخول)
    auth/           signup · login · logout · me — حسابات حقيقية بجلسة موقّعة
    webhooks/salla.js   استقبال أحداث سلة (تحقق توقيع HMAC إلزامي)
    store/          status · config · context · overview · publish · logo (شعار المتجر)
    trendyol/       connect (تحقق حقيقي قبل الحفظ) · sync (منتجات/أسعار/طلبات)
migrations/         مخطط D1 (الجداول الجديدة TEXT merchant ids — القديمة legacy)
persona/            نسخة مرجعية للشخصية (التشغيلية بـ functions/_lib/persona.js — عدّل الاثنين)
docs/               قرارات التصميم (ثيم/حركة)
scripts/stage.mjs   بناء dist/ — المصدر الوحيد لما يُنشر
```

## أوامر

```bash
npm run stage    # بناء dist/
npm run dev      # تشغيل محلي (wrangler pages dev)
npm run deploy   # نشر على hala-ai-os.pages.dev
npx wrangler d1 migrations apply halah-tr-db --remote   # تطبيق مخطط جديد
```

## الأسرار (wrangler secrets — ممنوع بالكود)

| السر | الاستخدام |
|---|---|
| `SESSION_SECRET` | توقيع كوكي جلسة الحسابات (HMAC) — مُخزَّن فعلاً |
| `SALLA_APP_ID` | رابط تثبيت التطبيق (يفعّل التدفق الحقيقي بـ onboarding) |
| `SALLA_CLIENT_ID` / `SALLA_CLIENT_SECRET` | تجديد التوكنات |
| `SALLA_WEBHOOK_SECRET` | تحقق توقيع الـ webhooks |
| `WHATSAPP_TOKEN` | توكن System User الدائم (Meta) — إرسال رسائل |
| `WHATSAPP_PHONE_ID` | معرّف رقم الواتساب (phone_number_id) |
| `WHATSAPP_VERIFY_TOKEN` | كلمة تحقق webhook (تختارها أنت، تطابقها بإعداد Meta) |
| `WHATSAPP_APP_SECRET` | سر تطبيق Meta — تحقق توقيع الرسائل الواردة |
| `HF_TOKEN` | **اختياري** — مزود احتياطي لتوليد صور المنتجات (Hugging Face) لو خلصت حصة Cloudflare اليومية. النظام يشتغل بدونه بحدود Cloudflare وحدها. رصيده المجاني رمزي جداً ($0.10/شهر ≈ 3-4 صور) — مكافأة نادرة مو سعة أساسية |
| `ADMIN_EMAILS` | إيميلات مفصولة بفاصلة، تحدد مين يقدر يفتح `/admin.html` — بدون عمود role بقاعدة البيانات |

تُضاف بـ: `npx wrangler pages secret put SALLA_WEBHOOK_SECRET --project-name hala-ai-os`

مفاتيح Trendyol ليست أسرار بيئة — كل تاجر يدخل مفاتيحه بفورم الربط وتُخزن بـ D1
بعد تحقق فعلي (`/api/trendyol/connect`).

## قائمة جاهزية مراجعة سلة

- [ ] حساب [salla.partners](https://salla.partners) موثق + تطبيق منشأ (Easy Mode)
- [ ] Scopes: `products.read_write, orders.read, customers.read, carts.read, webhooks.read_write, offline_access`
- [ ] Webhook URL: `https://hala-ai-os.pages.dev/api/webhooks/salla` + استراتيجية Signature
- [ ] الأسرار الثلاثة مضبوطة بـ Pages
- [ ] اختبار على متجر ديمو: تثبيت → `app.store.authorize` يوصل → المنتجات تظهر بالداشبورد
- [x] صفحة سياسة خصوصية (`/privacy.html`)
- [ ] وصف التطبيق وأيقونته ببوابة الشركاء

## قرارات معلقة (تحتاج قرار المالك)

1. حذف D1 القديمة `hala_db` (32 جدول فاضي) — بعد `wrangler d1 export hala_db`
2. حذف الجداول legacy بـ `halah-tr-db` (`users`, `store_connections`, `synced_products`, `merchant_marketing_contexts`, `faqs`, `store_documents`) — الجداول الجديدة حلت محلها
3. مصير مشروع Pages القديم `halah-dashboard` ودومين `halah.aura.sa`
4. دعم منصة زد (مؤجل بقرار سابق)

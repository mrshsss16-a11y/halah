# AGENT.md — دليل بنية مشروع هالة (Hala AI OS) لأي وكيل ذكاء اصطناعي

> اقرأ هذا الملف كامل قبل أي تعديل. يشرح البنية، القواعد الصارمة، والمشاكل المفتوحة.
> آخر تدقيق شامل: 2026-07-31 · §٣ و§٦ مُزامنان مع الشجرة 2026-09-08.

---

## 1. ما هو المشروع

**هالة** = مساعدة خدمة عملاء بالذكاء الاصطناعي، بلهجة سعودية بيضاء، تخدم **أورا للتسويق**
(وكالة تسويق رقمي سعودية، مقرها مكة). تعمل على واتساب وعلى ويدجت الموقع. تجاوب استفسارات
العملاء، تحجز استشارات، وتتكامل مع منصات المتاجر (سلة، Trendyol، زد).

**مهم:** "هالة" شخصية خدمة عملاء **تمثّل أورا** — ليست منتجاً يُباع باسم "هالة". لا تفترض أن
العميل صاحب متجر إلكتروني؛ قد يكون أي نشاط تجاري.

---

## 2. البنية التقنية — كل شيء على Cloudflare

| الطبقة | التقنية |
|---|---|
| الاستضافة | Cloudflare Pages (مشروع `hala-ai-os`, فرع الإنتاج **`main`**) |
| الواجهة | HTML ثابت (جذر المستودع) + `partials/` عبر `#include` → `scripts/stage.mjs` |
| الـ API | Pages Functions: `functions/api/*` → `/api/*` |
| توليد النصوص | AI Gateway متعدد المزودين (`functions/_lib/ai/gateway.js`) — انظر §5 |
| ذاكرة RAG | Vectorize `halah-tr-faq` (embeddings `@cf/baai/bge-m3`, عزل بـ metadata `storeId`) |
| قاعدة البيانات | D1 `halah-tr-db` (id: `4d8955ff-f2db-4447-8817-fe1149cce582`) |
| كاش + rate limit | KV `HALA_CACHE` |

Bindings معرّفة في `wrangler.toml`: `AI`, `VECTORIZE_INDEX`, `DB`, `HALA_CACHE`.

---

## 3. خريطة المجلدات (العقد المعماري بـ`docs/ARCHITECTURE.md` — مفروض آلياً بـ`npm test`)

```
functions/
  _lib/
    core/          بنية تحتية فقط: respond (withApi + withApi.raw) · errors (ApiError/DomainError) · errorLog
                   session · identity · csrf · crypto · cors · rateLimit · security · oauthState · adminEmails
                   auditLog · heartbeat · limits · meter
    domain/        منطق الأعمال — ملف لكل مجال، لا يعرف HTTP: auth · accounts · salla · whatsapp ·
                   whatsappAutoReply · whatsappInbound · whatsappConnect · bulk · bulkTick · catalog · catalogSync
                   review · reviewGuards · publish · copy · copyParse · conversation · support · storeProfile
                   storeOverview · sallaProductPayload · quota · faq · booking · analytics · health · instagram
                   persona · platforms · auraAgent
    integrations/  محوّلات HTTP خالصة (صفر D1): salla · whatsapp · instagram · email
    ai/            gateway · vision · parseModelJson · guards (أسعار + محدِّدات) · persona (المصدر الوحيد)
                   prompts/{seo,chat,support,whatsapp,instagram} · memory · intents · productTaxonomy · supportPlaybook
    imageProvider.js
  api/**           تنسيق فقط (≤ ٨٠ سطراً، صفر SQL، صفر prompt، لا يستورد integrations):
                   auth/* · store/{catalog,bulk,review,…} · admin/* · whatsapp/* · instagram/webhook · webhooks/salla
                   cron/{reminders,healthcheck,bulk_process} · chat · copy · support · image · health · stats · usage
cron-worker/         Worker منفصل */10 يضرب الـcron الثلاث بـCRON_SECRET
partials/            head-common (كل الصفحات) · dashboard-* · admin-*   (#include عبر scripts/stage.mjs)
public/js/           shared.js · dashboard/{state,api,render,catalog,studio,bulk,review,agent,whatsapp,store,account,tabs,main}.js · admin/*
styles/              01..08 تُدمج في dist/style.css (08-shared-components = الأصناف المشتركة بقيمة واحدة)
*.html               صفحات هيكلية قصيرة (dashboard 43 سطراً، admin 40)
migrations/          مخطط D1 (0001..0027) — انظر §6
persona/             مولَّد آلياً من ai/persona.js بـscripts/export-persona.mjs — لا يُحرَّر يدوياً
tests/unit/*         ٢٤ ملف وحدة · tests/integration/* ٦ موجات · tests/frontend.test.mjs · tests/_helpers.mjs
scripts/             stage (ينظّف dist ثم يبني) · verify-dist · run-tests (يجمع tests/**، حد أدنى ١٠١٠ تأكيداً)
                     audit-{isolation,security,dead-exports,file-size,layering,migrations,frontend} (كلها ضمن npm test)
                     backup-db · smoke-test · export-persona
```

**الحراس (قوائم السماح صفرية):** أي ملف `api` فوق ٨٠ سطراً أو `_lib` فوق ٤٠٠ أو HTML فوق ٨٠٠، أي استيراد بالاتجاه الخاطئ (ق١–ق٦)، أي تصدير بلا مستورد، أي عمود بلا هجرة، أي `innerHTML` غير مهرَّب، أي `resolveStoreId` بلا تبرير — يُسقط `npm test`.

---

## 4. البناء والنشر — نظام واحد فقط

**قرار معماري محسوم (2026-07-31): HTML ثابت + `functions/`. لا Astro.**
تجربة Astro مؤرشفة في `docs/archive/astro-experiment/` (لا تُبنى ولا تُنشر).

```bash
npm run deploy      # build (stage.mjs) → verify-dist → نشر على main
```

### ⚠️ اللغم الذي فرض هذا القرار

`astro build` مع محوّل Cloudflare ينتج `dist/_worker.js`. وجوده يحوّل Cloudflare Pages إلى
**Advanced Mode**، وفيه **يتجاهل مجلد `functions/` بالكامل**. حدث فعلياً وأسقط كل الـ ٥٦
endpoint إلى 404 على الإنتاج — بما فيها ويبهوك واتساب وتسجيل الدخول.

**الحماية الآلية:** `scripts/verify-dist.mjs` يعمل داخل `npm run deploy` ويرفض النشر
(exit 1) لو وجد `_worker.js` أو `_routes.json`. لا يمكن تكرار العطل عبر المسار الطبيعي.

- ✅ `dist/` = HTML + `_headers` فقط.
- ✅ النشر يطبع `✔ dist/ is safe` ثم `✨ Uploading Functions bundle`.
- ✅ **انشر دائماً بـ `--branch=main`** (مضمّن في `npm run deploy`) — بدونها يذهب لفرع
  Preview ولا يراه أحد على الدومين الحي.
- ❌ لا تُعِد إدخال Astro أو أي أداة تنتج `_worker.js` بدون هجرة كاملة ومقصودة لكل
  الـ endpoints (اقرأ `docs/archive/astro-experiment/README.md` أولاً).

### ⚠️ لا `_redirects` بقواعد `/x /x.html 200`
Cloudflare Pages يخدم المسارات النظيفة تلقائياً (`/dashboard` ← `dashboard.html`) ويحوّل
`/dashboard.html` → `/dashboard` بـ308. قاعدة rewrite إلى `.html` تُنتج **حلقة 308 لا نهائية**
— حدث فعلياً 2026-09-09 وأسقط `/dashboard` (إطار سلة) حتى حُذف الملف. لا تُنشئ `_redirects`
لمسارات نظيفة؛ تُستخدم فقط لتحويلات حقيقية (دومين قديم → جديد).

### التحقق الإلزامي بعد أي نشر

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://hala-ai-os.pages.dev/api/health   # 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://hala-ai-os.pages.dev/api/whatsapp/webhook -d '{}'                        # 401
npx wrangler pages deployment list --project-name hala-ai-os | grep Production
```
404 على أي منهما = الـ API ساقط.

---

## 5. AI Gateway — تعاقب أربع طبقات (`functions/_lib/ai/gateway.js`)

قبل أي استدعاء: بحث في كاش KV (`HALA_CACHE`). ثم بالترتيب:

1. **Cloudflare Workers AI** — `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (الأساسي، مجاني على الحافة)
2. **Groq** — لو `GROQ_API_KEY` مضبوط
3. **OpenRouter** — لو `OPENROUTER_API_KEY` مضبوط (نماذج مجانية)

`TEXT_MODEL` هو الافتراضي المعتمد للجودة. `FAST_TEXT_MODEL` (3b) أسرع لكن **جودته أضعف
بوضوح للعربية** — اختُبر ورُفض لمحادثات هالة (يهلوس ويخترع خدمات). لا تستخدمه لردود العملاء.

---

## 6. قاعدة البيانات — D1 `halah-tr-db`

- Migrations في `migrations/` (0001..0027 كلها مطبَّقة على البعيد، تحقق 2026-09-09 — 0027 `cron_heartbeat` طُبِّقت ونبض الـcron `ok` بـ`/api/health`)  انظر §13 O2). طبّق بـ: `npx wrangler d1 migrations apply halah-tr-db --remote`
- 0003 placeholder (للحفاظ على تسلسل الأرقام). 0010 أنشأ الجداول الناقصة سابقاً.
- **جداول بالمخطط لا يذكرها الكود — المصدر الوحيد للقائمة.**
  `scripts/audit-migrations.mjs` (فحص م٢) يقرأ الكتلة أدناه حرفياً؛ لا تكرّرها بالسكربت.
  لتغيير القائمة: عدّل هنا فقط. حذف أي منها من الإنتاج **يحتاج نسخة احتياطية
  متحقَّقاً منها (`npm run backup`) + قرار مالك المشروع** — قرار مؤجَّل، انظر
  `docs/DEFERRED.md`.

  <!-- LEGACY_TABLES:START (تُقرأ آلياً — سطر لكل جدول: `اسم` — السبب) -->
  - `users` — legacy من بناء سابق، حلّت محلها accounts/merchants
  - `faqs` — legacy، حلّ محلها store_faqs
  - `store_connections` — legacy، حلّ محلها oauth_tokens/wa_connections
  - `synced_products` — legacy، حلّ محلها store_products
  - `merchant_marketing_contexts` — legacy من بناء سابق
  - `store_documents` — legacy من بناء سابق
  - `merchants_meta` — بيانات وصفية تشغيلية تُقرأ بأدوات التشغيل لا بالكود
  - `pending_retargeting` — مخطط بلا ميزة؛ دواله الميتة حُذفت بالمرحلة ١
  <!-- LEGACY_TABLES:END -->
- **قبل أي ادعاء أن جدولاً موجود، تحقق فعلياً:**
  `npx wrangler d1 execute halah-tr-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"`

### النسخ الاحتياطي (`scripts/backup-db.mjs`)

- `npm run backup` يصدّر D1 كاملة (مخطط + بيانات) إلى `backups/` (مستثنى من git)، ويتحقق بعد
  التصدير أن الملف يحوي `CREATE TABLE accounts` وأن عدد أسطره > ١٠٠ — وإلا `exit 1` ولا يُعتمَد
  على الملف (O5، 2026-09-09).
- **النسخ يدوي ومحلي فقط.** لا رفع تلقائي لأي تخزين خارجي (R2 أو غيره) — القرار بيد مالك
  المشروع، وهذا السكربت لا يتخذه نيابة عنه. يبقى `backups/` على جهاز المشغّل حتى يُنقَل يدوياً.
- لا اختبار استعادة آلي بعد (مذكور كدَين منخفض بـ`docs/EVALUATION_2026-09-09.md`).

---

## 7. الأمن وعزل المتاجر (multi-tenant)

- **الجلسة:** كوكي موقّع HMAC، الشكل `merchantId.expiry.sessionVersion.hmac` (`core/session.js`). النسخة
  تُقرأ من KV (`sv:<merchant>`) ثم D1؛ الخروج/إعادة التعيين/التعطيل يرفعونها فيقتلون كل توكن أقدم (P40).
- **CSRF:** `core/csrf.js` داخل `withApi()` وبالمعالجات الخام — Origin بقائمة سماح + جسم JSON فقط (P42). `SESSION_SECRET` **إلزامي** — الكود يرمي خطأ بدونه (لا قيمة افتراضية مكتوبة).
- **`resolveStoreId`:** الجلسة تتغلب دائماً على أي `storeId` يدّعيه العميل. متجر بلا حساب
  (تثبيت سلة Easy-Mode) يُعرّف بـ id غير قابل للتخمين فقط.
- **`requireAdmin`:** يتحقق من إيميل الحساب مقابل `ADMIN_EMAILS` (سر بيئة) فقط. **لا عمود
  `is_admin` في قاعدة البيانات** — عمداً: لا مسار لمنح صلاحية أدمن بالكتابة للـ DB.
- **تواقيع الـ webhooks:** سلة (`X-Salla-Signature`) وواتساب (`X-Hub-Signature-256`) —
  HMAC-SHA256 على الـ body الخام، مقارنة timing-safe. رفض صارم (401) عند الفشل.
- **OAuth CSRF:** تدفقات سلة وزد تمرّر `state` موقّع HMAC (`core/oauthState.js`) مربوط
  بكوكي `hala_oauth_state` قصير العمر (١٠ دقائق، استخدام واحد). الـ callback يرفض (400)
  أي طلب بلا state صالح ومطابق للكوكي — يمنع ربط متجر المهاجم بجلسة الضحية.

### قواعد ذهبية للأمن (لا تكسرها)
- لا أسرار مكتوبة بالكود، لا قيم افتراضية للأسرار. غياب السر = رمي خطأ، لا "تمرير برشاقة".
- لا باب خلفي، لا كلمة مرور مكتوبة، لا تجاوز مصادقة بأي علم بيئة.

---

## 8. شخصية هالة (`functions/_lib/ai/persona.js`)

مصدر واحد فقط: `HALA_WHATSAPP_SUPPORT_PROMPT` (لواتساب) و `HALA_SUPPORT_PROMPT` (للموقع).
`aura_whatsapp.js` يستورد من نفس المصدر (لا تكرار). قواعد الشخصية المضمّنة:

- تعرّف بنفسها أول رسالة فقط، تفهم قصد العميل (لا نمط ثابت حسب طول الرسالة).
- **ممنوع منعاً باتاً ذكر أي رقم سعر** — توجّه للاستشارة المجانية دائماً.
- ممنوع اختلاق خدمة غير موجودة أو ربط موضوع غريب بأورا بشكل مصطنع.
- تطابق لغة العميل (عربي/إنجليزي)، تصحح الأخطاء الإملائية بصمت.
- المواضيع الشخصية/الترفيهية: تحوّلها بخفة، ليست صديقة ولا معالجة. ضيق نفسي حقيقي → `[ESCALATE]`.
- حجز الاستشارة **آخر خطوة** بعد فهم الحاجة، لا أول رد.

**بوابات التصعيد** (`whatsapp/webhook.js`): `DISABLE_ESCALATION_GATES` يجب أن يبقى `false`
في الإنتاج. عند التصعيد أو رد بشري يدوي، البوت يصمت ساعتين (`HUMAN_SILENCE_WINDOW_MS`).

---

## 9. واتساب

- استقبال: `POST /api/whatsapp/webhook` (تحقق توقيع → تسجيل → رد تلقائي).
- إرسال: `functions/_lib/integrations/whatsapp.js` (Cloud API, `graph.facebook.com/v21.0`).
- الأسرار: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`.
- التوكن الحالي **مؤقت** (ينتهي كل ~ساعة). المطلوب: **System User Token دائم** من Meta
  Business Settings (صلاحيات `whatsapp_business_messaging` + `whatsapp_business_management`).
- Webhook URL بميتا: `https://hala-ai-os.pages.dev/api/whatsapp/webhook`, verify token: `hala2026verify`.
- Coexistence: الرقم يعمل بالتطبيق + API معاً؛ الرد اليدوي يصل كـ echo (`source: "human"`).

---

## 10. الأسرار والمتغيرات (محدَّثة 2026-09-09 — `grep -rhoE 'env\.[A-Z_]+|env\?\.[A-Z_]+' functions cron-worker`)

إضافة أي سر: `npx wrangler pages secret put NAME --project-name hala-ai-os`.

### أسرار إلزامية (غيابها = رمي خطأ، لا قيمة افتراضية)
- `SESSION_SECRET` — توقيع كوكي الجلسة (HMAC). بدونه `core/session.js`/`core/csrf.js` يرميان خطأ.
- `ENCRYPTION_KEY` — تشفير بيانات اعتماد الأطراف الثالثة بالراحة (`core/crypto.js`):
  `oauth_tokens.access_token/refresh_token` · `platform_connections.api_key/api_secret` ·
  `wa_connections.business_token` · `ig_connections.access_token`. غيابه = رمي عند الكتابة
  (fail closed). حارس ح٩ بـ`audit-security.mjs` يمنع عودة أي عمود `*_token`/`*_secret` لنص صريح.
- `ADMIN_EMAILS` — قائمة إيميلات مفصولة بفواصل يقارنها `requireAdmin`/`adminEmails.js` — لا عمود `is_admin`.
- `SALLA_APP_ID`, `SALLA_CLIENT_ID`, `SALLA_CLIENT_SECRET` — تدفق OAuth Easy Mode لسلة.
- `SALLA_WEBHOOK_SECRET` — تحقق `X-Salla-Signature` بـ`webhooks/salla.js` (401 عند الفشل).
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` — إرسال رسائل واتساب (Cloud API، خط أورا).
- `WHATSAPP_VERIFY_TOKEN` — تحقق GET webhook عند إعداده بميتا.
- `WHATSAPP_APP_SECRET` — تحقق `X-Hub-Signature-256` (`verifyWaSignature`، fail-closed).
- `CRON_SECRET` — يحرس `Authorization: Bearer` على `api/cron/*` كلها؛ بدونه الوظائف ترفض 500 (`CRON_NOT_CONFIGURED`) بدل تشغيل بلا حماية.

### اختيارية بمزوّد (fallback يُعطَّل بلا كسر التشغيل، أو تحسين اختياري)
- `GROQ_API_KEY` — الطبقة الثانية بتعاقب AI Gateway.
- `OPENROUTER_API_KEY` — الطبقة الثالثة (نماذج مجانية).
- `HF_TOKEN` — احتياطي `imageProvider.js` (Hugging Face) خلف klein الأساسي.
- `TURNSTILE_SECRET_KEY` — تحقق كابتشا Turnstile؛ غيابه يمرّر الطلبات (N7، دَين موثّق).
- `RESEND_API_KEY` — إرسال بريد (استعادة كلمة مرور، تحقق إيميل) عبر `integrations/email.js`؛ fail-closed بلا مفتاح.
- `EMAIL_FROM` — عنوان المرسل لنفس مزوّد البريد.
- `GOOGLE_CLIENT_ID` — تحقق توكن Google Sign-In بـ`auth/google.js`.
- `META_APP_ID`, `META_APP_SECRET` — تطبيق ميتا لإنستغرام/واتساب Embedded Signup.
- `INSTAGRAM_APP_SECRET`, `INSTAGRAM_VERIFY_TOKEN` — ويبهوك إنستغرام (مبني، غير مفعَّل بعد).
- `WA_SIGNUP_CONFIG_ID` — Embedded Signup لواتساب من لوحة التاجر؛ غيابه يعطّل تبويب الربط بصدق (لا وهم اتصال).

### إعدادات بيئة غير سرية
- `STORE_WA_PHONE` — رقم واتساب الموظف/الأدمن لتذكيرات الاستشارة وتنبيهات الصحة؛ غيابه = تخطي تذكير الموظف مع تسجيل، لا رقم مفبرك (P49).
- `MERCHANT_WA_PHONE` — بديل تسمية لنفس الغرض بمسارات أقدم.
- `WHATSAPP_MERCHANT_ID` — معرّف WABA لبعض عمليات Coexistence.
- `WIDGET_ALLOWED_ORIGINS` — قائمة سماح CORS لودجت `/api/support`.
- `HALA_DEBUG_AI` — تفعيل تسجيل تشخيصي إضافي لمسار AI (تطوير فقط).

### Bindings (ليست أسراراً — `wrangler.toml`)
`AI` (Workers AI), `VECTORIZE_INDEX`, `DB` (D1)، `HALA_CACHE` (KV).

---

## 11. قاعدة الصدق (مبدأ أساسي للمشروع)

لا بيانات مفبركة تُعرض كأنها حقيقية — لا أسعار مخترعة، لا أرقام طلبات وهمية، لا أسماء عملاء
وهمية، لا ادعاء "نشط 100%" لنظام غير مضبوط، لا ادعاء امتثال قانوني (PDPL) بمجرد فحص تقني.
هذا يشمل الكود التجريبي: أي endpoint يرجّع بيانات وهمية يجب حذفه أو تعليمه بوضوح.

---

## 12. سير العمل

```bash
npm run build      # بناء dist/ (stage.mjs)
npm run verify:dist # فحص أمان المخرجات (يعمل تلقائياً ضمن deploy)
npm run deploy     # build + verify + نشر للإنتاج (main)
npm test           # tests/api.test.mjs
npm run dev        # تشغيل محلي (wrangler pages dev)
npx wrangler d1 migrations apply halah-tr-db --remote   # تطبيق المخطط
graphify query "<سؤال>"   # فهم البنية قبل أي تعديل (إلزامي)
graphify update .          # تحديث الجراف بعد التعديل (AST فقط، بلا تكلفة)
```

---

## 13. المشاكل المفتوحة (محدّثة 2026-09-06 — تحقق مباشر من الكود، لا نقل من نسخة سابقة)

**خارطة الإطلاق المرجعية: [`docs/ROADMAP.md`](docs/ROADMAP.md)** — الترتيب والأولويات
والمسؤوليات من هناك. خطة التنفيذ التفصيلية: `docs/PARALLEL_TRACKS.md` (المعايير)
و`docs/PLAN_90_DAYS.md` (الجدول). ملخص الدَين التقني الفعلي:

**✅ مُصلَح بالفعل (كان موثّقاً كدَين هنا سابقاً — تحقق 2026-09-06، لا تُعِد فتحه بلا تحقق جديد):**
- `verifyWaSignature` fail-closed فعلاً (`functions/_lib/integrations/whatsapp.js:38`: `if (!appSecret) return false`). — P2 ✅
- حصة صور المنتجات: `image.js` تستخدم `checkAndConsumeMonthly` + `resolveStoreId` (عزل لكل متجر، لا حساب أدمن مشترك).
- تدقيق العزل آلي فعلاً: `scripts/audit-isolation.mjs` مربوط بـ`package.json:11` ضمن `npm test`. — P5 ✅
- `requestId` منفَّذ بالكامل: `functions/_lib/core/respond.js:51` (`generateRequestId()`)، يُمرَّر لرأس `X-Request-Id` (٧٤/٧٧/٨٦/٩٨)، لكل `logError` (٨١/٨٩)، ولجسم الخطأ (٨٤/٩٥). — P7 ✅
- صفحة أخطاء الأدمن منفَّذة: `functions/api/admin/errors.js` (`requireAdmin` سطر ١٢ ثم `SELECT ... FROM error_log` سطر ١٧). — P8 ✅
- جدول `error_log` **متحقَّق منه على D1 البعيد** (لا ادعاء): نسخة `backups/halah-tr-db_2026-09-06T04-52-55_full.sql` تحوي `CREATE TABLE error_log` (سطر ٥٣٠) + فهرسين، وهجرة `0015_error_log.sql` مسجّلة مطبَّقة `2026-09-06 03:06:33`.
- تسجيل أخطاء مهيكل بدأ (`core/errorLog.js` + `respond.js`) — **لم يكتمل**، انظر أدناه.

**❌ باطل — لا يُنفَّذ ولا يُعاد فتحه (ليس دَيناً):**
- `[observability]` بـ`wrangler.toml`: **Cloudflare Pages يرفض المفتاح صراحةً** (Workers-only). جُرِّب حياً وفشل `npm run deploy` فوراً — التفاصيل بـ`wrangler.toml:32-39`. البديل المنفَّذ: `error_log` على D1 + `/api/admin/errors`. لا تُعِد إضافته. — P6 ❌
- fail-open عند فشل **فحص** الحصة بـ`functions/api/whatsapp/webhook.js:107-121`: **قرار مدير 2026-09-06**، متعمَّد — البوت يبقى يرد أثناء عطل D1/KV بدل توقف كل التجار، وكل حالة تُسجَّل بـ`logError` وتُطلق تنبيهاً مخنوقاً (`checkRateLimit` سطر ١١٩). ليس دَيناً معلَّقاً ولا يحتاج قراراً جديداً. — P28 ✅

**متوسط (متانة) — لا يزال قائماً:**
- `verifyTurnstileToken` يمرّر الكل عند غياب المفتاح — مقبول كطبقة إضافية، لكن موثّق هنا فقط لأمانة العرض.
- **"٦ مسارات بلا حصة" (البند الشهير بالتوثيق السابق) — تحقُّق 2026-09-06 يُبطله شبه كلياً:**
  `scan`/`sandbox`/`trendyol/qa` **مؤرشفة، لا تعمل** (`docs/archive/deprioritized-features/`) —
  صفر تعرّض. `support.js` معفى بالتصميم (`storeId: "hala"` ثابت، ودجت أورا نفسه، محمي
  بـ`checkRateLimit` لا بالحصة). `admin/aura_whatsapp` معفى عمداً (`UNMETERED_MERCHANT_IDS`).
  `whatsapp/webhook.js` **مُقاس فعلاً** (`checkAndConsumeMonthly` — `webhook.js:110-111`).
  البند مغلق كلياً (P4 ✅). الفرع الأخير منه (fail-open عند فشل الفحص) **حُسم بقرار مدير
  2026-09-06** — انظر قسم "باطل" أعلاه، لم يعد دَيناً.
- ~~رقم التذكرة مزدوج المصدر~~ — P18 ✅ أُغلق 2026-09-08: `reminders.js` يقرأ `booking.ticket_code` (اختبار P18-1). معه أُزيل رقم الموظف المفبرك `966500000000` (P49) — غياب `STORE_WA_PHONE` = تخطي تذكير الموظف مع `logError`.
- ~~ويبهوك واتساب بلا `checkRateLimit`~~ — P21 ✅ 2026-09-08: ٦٠٠/دقيقة بعد التوقيع.
- ~~٩ ملفات `console.error` خام~~ — ✅ 2026-09-08: صفر `console.error` خارج `errorLog.js`، محروس باختبار LOG-1. P23 وP26 أُغلقا بنفس الدفعة (`timingSafeEqualStr` بـ`core/crypto.js`).
- لا cron trigger أصلي بـ`wrangler.toml` — **معالج فعلياً** عبر `cron-worker/` منفصل (Pages لا يدعم cron triggers أصلاً)، هذا السطر توثيقي لا دَين حقيقي.
- توكن واتساب دائم بدل المؤقت — **يفكّ الحجب الحالي**، أولوية قصوى (مسار د، `PARALLEL_TRACKS.md`).

**منخفض (جودة):**
- توسيع تغطية الاختبارات — التحسّن حقيقي (٣٨ اختبار، منها عزل متاجر فعلي: كاش، جلسة، Vectorize)، لكن لا تغطية على التوقيعات نفسها بعد.
- استشارة قانونية PDPL فعلية (الكود يقدّم تقييماً تقنياً فقط).

**⚠️ قاعدة لمن يقرأ هذا القسم:** تحقق من الكود قبل الاعتماد على أي سطر هنا كحقيقة حالية —
هذا القسم يفوت التحديث بسهولة بعد إصلاحات جانبية. مزامنة 2026-09-06 (الثانية) وجدت
**٦ بنود** موثّقة كدَين لم تكن كذلك (P2 · P4 · P5 · P6 · P7 · P8 — خمسة مُصلَحة سلفاً،
وواحد مستحيل على Pages)، و**بنداً واحداً موثّقاً كمُصلَح وهو ليس كذلك** (P18، رقم التذكرة).
الخطأ يقع بالاتجاهين — تحقّق دائماً بـ`ملف:سطر`.

**ملاحظة توثيق:** أي endpoint في §3 يجب أن يبقى صادقاً بمخرجاته (§11). عند تعديل أي شخصية،
عدّل `functions/_lib/ai/persona.js` **و** النسخة المرجعية في `persona/`.

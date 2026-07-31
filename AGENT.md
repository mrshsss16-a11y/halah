# AGENT.md — دليل بنية مشروع هالة (Hala AI OS) لأي وكيل ذكاء اصطناعي

> اقرأ هذا الملف كامل قبل أي تعديل. يشرح البنية، القواعد الصارمة، والمشاكل المفتوحة.
> آخر تدقيق شامل: 2026-07-31.

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
| الواجهة | **هجين:** HTML ثابت (جذر المستودع) + Astro (`src/`) — انظر §4 |
| الـ API | Pages Functions: `functions/api/*` → `/api/*` |
| توليد النصوص | AI Gateway متعدد المزودين (`functions/_lib/ai/gateway.js`) — انظر §5 |
| ذاكرة RAG | Vectorize `halah-tr-faq` (embeddings `@cf/baai/bge-m3`, عزل بـ metadata `storeId`) |
| قاعدة البيانات | D1 `halah-tr-db` (id: `4d8955ff-f2db-4447-8817-fe1149cce582`) |
| كاش + rate limit | KV `HALA_CACHE` |

Bindings معرّفة في `wrangler.toml`: `AI`, `VECTORIZE_INDEX`, `DB`, `HALA_CACHE`.

---

## 3. خريطة المجلدات

```
functions/
  _lib/
    ai/           gateway (تعاقب المزودين) · persona · memory (RAG) · intents · typoCorrector
    core/         db · session · auth · crypto · meter (حصص) · rateLimit · respond · security
    integrations/ salla · trendyol · zid · whatsapp · dlq
    imageProvider.js   (klein أساسي + Hugging Face احتياطي)
  api/
    auth/         signup · login · logout · me · google · forgot_password · reset_password
                  salla/{install,callback} · zid/{install,callback}
    store/        status · config · context · overview · publish · logo · persona · report
                  broadcast · campaign · cart_recovery · digest · ingest · recovery
                  instant_agent · sandbox · ocr · voice · zatca
    admin/        overview · accounts · bookings · conversations · faq · project · aura_whatsapp
    trendyol/     connect · sync · qa
    webhooks/     salla · trendyol · shipping · zid
    whatsapp/     webhook (استقبال) · send (إرسال)
    chat · copy · image · scan · support · usage · stats · health
    cron/reminders.js       (تذكير مواعيد — لكن لا cron trigger مضبوط في wrangler.toml بعد)
    security/pdpl_audit.js   (تقييم تقني، وليس شهادة امتثال قانوني)
src/                 نظام Astro (pages/ + components/ + layouts/) — انظر §4 للتحذير
*.html               صفحات ثابتة قديمة تمر بـ #include ثم scripts/stage.mjs → dist/
partials/            مكونات #include (fouc-theme, app-shell)
migrations/          مخطط D1 (0001..0010) — انظر §6
persona/             نسخ مرجعية للشخصية (التشغيلية في functions/_lib/ai/persona.js — عدّل الاثنين)
tests/api.test.mjs   26 اختبار
scripts/stage.mjs    بناء dist/ للنظام الثابت القديم
```

---

## 4. ⚠️ تحذير البناء — نظامان يستهدفان `dist/`

المشروع في مرحلة انتقال من HTML ثابت إلى Astro. الاثنان يبنيان إلى `dist/`:

- `npm run stage` → `scripts/stage.mjs` (النظام الثابت القديم — الصفحات في جذر المستودع)
- `npm run build` → `stage.mjs` **ثم** `astro build` (النظام الجديد)
- `npm run deploy` → `build` + `wrangler pages deploy dist --branch=main`

**قواعد صارمة:**
1. **انشر دائماً بـ `--branch=main`** — بدونها ينشر لفرع Preview ولا يراه أحد على الدومين الحي.
2. لا تشغّل `astro build` وحده على نظام ثابت أو العكس — استخدم `npm run deploy` الموحّد.
3. تحقق بعد النشر: `npx wrangler pages deployment list ... | grep Production`.

---

## 5. AI Gateway — تعاقب أربع طبقات (`functions/_lib/ai/gateway.js`)

قبل أي استدعاء: بحث في كاش KV (`HALA_CACHE`). ثم بالترتيب:

1. **Cloudflare Workers AI** — `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (الأساسي، مجاني على الحافة)
2. **Groq** — لو `GROQ_API_KEY` مضبوط
3. **OpenRouter** — لو `OPENROUTER_API_KEY` مضبوط (نماذج مجانية)
4. **DeepSeek** — لو `DEEPSEEK_API_KEY` مضبوط

`TEXT_MODEL` هو الافتراضي المعتمد للجودة. `FAST_TEXT_MODEL` (3b) أسرع لكن **جودته أضعف
بوضوح للعربية** — اختُبر ورُفض لمحادثات هالة (يهلوس ويخترع خدمات). لا تستخدمه لردود العملاء.

---

## 6. قاعدة البيانات — D1 `halah-tr-db`

- Migrations في `migrations/` (0001..0010). طبّق بـ:
  `npx wrangler d1 migrations apply halah-tr-db --remote`
- 0003 placeholder (للحفاظ على تسلسل الأرقام). 0010 أنشأ الجداول الناقصة سابقاً.
- جداول قديمة (legacy) لا تزال موجودة من بناء سابق: `users`, `faqs`, `store_connections`,
  `synced_products`, `merchant_marketing_contexts`, `store_documents`. الجداول الجديدة حلّت محلها.
- **قبل أي ادعاء أن جدولاً موجود، تحقق فعلياً:**
  `npx wrangler d1 execute halah-tr-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"`

---

## 7. الأمن وعزل المتاجر (multi-tenant)

- **الجلسة:** كوكي موقّع HMAC، الشكل `merchantId.expiry.hmac` (`core/session.js`). لا لمسة DB
  للتحقق. `SESSION_SECRET` **إلزامي** — الكود يرمي خطأ بدونه (لا قيمة افتراضية مكتوبة).
- **`resolveStoreId`:** الجلسة تتغلب دائماً على أي `storeId` يدّعيه العميل. متجر بلا حساب
  (تثبيت سلة Easy-Mode) يُعرّف بـ id غير قابل للتخمين فقط.
- **`requireAdmin`:** يتحقق من إيميل الحساب مقابل `ADMIN_EMAILS` (سر بيئة) فقط. **لا عمود
  `is_admin` في قاعدة البيانات** — عمداً: لا مسار لمنح صلاحية أدمن بالكتابة للـ DB.
- **تواقيع الـ webhooks:** سلة (`X-Salla-Signature`) وواتساب (`X-Hub-Signature-256`) —
  HMAC-SHA256 على الـ body الخام، مقارنة timing-safe. رفض صارم (401) عند الفشل.

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

## 10. الأسرار (wrangler secrets — ممنوع بالكود)

`SESSION_SECRET`, `ENCRYPTION_KEY`, `ADMIN_EMAILS`, `SALLA_*` (APP_ID/CLIENT_ID/CLIENT_SECRET/WEBHOOK_SECRET),
`WHATSAPP_*` (TOKEN/PHONE_ID/VERIFY_TOKEN/APP_SECRET), `HF_TOKEN` (اختياري), وللمزودين الاختياريين:
`GROQ_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `TURNSTILE_SECRET_KEY`.
إضافة: `npx wrangler pages secret put NAME --project-name hala-ai-os`.

---

## 11. قاعدة الصدق (مبدأ أساسي للمشروع)

لا بيانات مفبركة تُعرض كأنها حقيقية — لا أسعار مخترعة، لا أرقام طلبات وهمية، لا أسماء عملاء
وهمية، لا ادعاء "نشط 100%" لنظام غير مضبوط، لا ادعاء امتثال قانوني (PDPL) بمجرد فحص تقني.
هذا يشمل الكود التجريبي: أي endpoint يرجّع بيانات وهمية يجب حذفه أو تعليمه بوضوح.

---

## 12. سير العمل

```bash
npm run stage      # بناء dist/ (الثابت)
npm run build      # stage + astro build
npm run deploy     # build + نشر للإنتاج (main)
npm test           # node tests/api.test.mjs
npx wrangler d1 migrations apply halah-tr-db --remote   # تطبيق المخطط
graphify query "<سؤال>"   # فهم البنية قبل أي تعديل (إلزامي)
graphify update .          # تحديث الجراف بعد التعديل (AST فقط، بلا تكلفة)
```

---

## 13. المشاكل المفتوحة (محدّثة 2026-07-31)

راجع `docs/UPGRADE_PLAN.md` للخطة الكاملة. ملخص الأولويات:

**متوسط (متانة):**
- `verifyWaSignature` يرجّع `true` عند غياب `WHATSAPP_APP_SECRET` — الأأمن `false`.
- `verifyTurnstileToken` يمرّر الكل عند غياب المفتاح — مقبول (طبقة إضافية) لكن يُوثّق.
- رقم التذكرة: عمود `ticket_code` في DB + حساب من `id` في الكود — وحّد المصدر.
- تغطية الحصص (quota): 6 endpoints تستدعي AI بلا `checkAndConsume`
  (`support`, `scan`, `sandbox`, `trendyol/qa`, `whatsapp/webhook`, `admin/aura_whatsapp`).
- لا cron trigger في `wrangler.toml` رغم وجود `cron/reminders.js`.
- توكن واتساب دائم بدل المؤقت.

**منخفض (جودة):**
- توسيع تغطية الاختبارات (26 اختبار حالياً، أغلبها تحقق تصدير الدوال).
- مراقبة أخطاء فعلية (حالياً `console.error` فقط).
- استشارة قانونية PDPL فعلية (الكود يقدّم تقييماً تقنياً فقط).

**ملاحظة توثيق:** أي endpoint في §3 يجب أن يبقى صادقاً بمخرجاته (§11). عند تعديل أي شخصية،
عدّل `functions/_lib/ai/persona.js` **و** النسخة المرجعية في `persona/`.

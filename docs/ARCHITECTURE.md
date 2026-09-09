# 🏗️ المعمارية المستهدفة ومراحل البناء — الحماية من النمو العشوائي

> كُتب 2026-09-09 بعد تدقيقين معماريين (أوبس للخلفية: ٥٨/١٠٠ · سونيت للواجهة: ٤٨/١٠٠).
> **التشخيص:** اتجاه التبعيات نظيف تماماً (صفر استيراد عكسي)، الشخصية مصدر واحد، لا سر بالكود.
> **المرض:** تضخّم غير مقسّم — `core/db.js` (١٤٨٥ سطراً، ٨٤ تصديراً، ٩ مجالات، ٤٠ مستورداً)،
> طبقة `api/*` سميكة (٤٠ استعلاماً خاماً + ٦ مواضع بناء prompt + منطق أعمال)، ٣٥ تصديراً ميتاً،
> `dashboard.html` ١٩٨٢ سطراً، آلية `#include` موثّقة وغير مستخدمة بأي صفحة، أصناف CSS متعارضة.
>
> **هذا الملف = العقد المعماري.** أي ملف جديد يُقاس عليه، والحراس الآلية (§٤) تفشل `npm test` عند الخرق.

---

## ١. الشجرة المستهدفة

```
functions/
  _lib/
    core/          بنية تحتية فقط — صفر SQL مجالي، صفر منطق أعمال
                   respond · errors · errorLog · session · csrf · crypto · cors · rateLimit
                   security · oauthState · adminEmails · auditLog · heartbeat · limits · db (اتصال + أدوات عامة فقط)
    domain/        منطق الأعمال — ملف لكل مجال، لا يعرف HTTP ولا Response
                   auth · accounts · catalog · review · copy · conversation · quota · whatsapp
                   salla · instagram · bulk · faq · booking · analytics · storeProfile
    integrations/  محوّلات بعقد isConfigured/receive/send — صفر D1، صفر منطق أعمال
                   whatsapp · salla · instagram · email
    ai/            gateway · persona · guards · memory · intents · productTaxonomy · supportPlaybook · parseModelJson
  api/**           تنسيق فقط: withApi ← تحقق مدخل ← استدعاء domain ← json(). سقف ٨٠ سطراً للملف.

partials/          head-common · app-shell (المستخدَم فعلاً) · dashboard-tab-*
public/js/         shared.js (escHtml · showMsg · showToast · checkSession) · dashboard/{api,render,tabs}.js
styles/            08-shared-components.css (sleek-* · wire-btn — قيمة واحدة لكل صنف)
tests/unit/        ملف لكل وحدة · tests/integration/ (ملفات الموجات) · scripts/run-tests.mjs يجمعها كلها
```

**قواعد الاتجاه (تُفرض آلياً):** `core` لا يستورد من `domain/ai/integrations/api` · `integrations` لا يستورد من `core/db` ولا `domain` · `domain` لا يستورد `respond.js` (يرمي `DomainError {code, userMessage, internal}` ويترجمها `withApi`) · `api` لا يحوي `.prepare(` ولا بناء system prompt.

## ٢. جدول الانتقال (من أين إلى أين)

| من | إلى |
|---|---|
| `db.js` حسابات/أقفال/google/trial (١٣ دالة) | `domain/auth.js` + `domain/accounts.js` |
| `db.js` واتساب (١١) | `domain/whatsapp.js` |
| `db.js` سلة/OAuth (١٠) + `integrations/salla.js:6→db` | `domain/salla.js` (التوكن يُمرَّر للمحوّل، لا يقرأه) |
| `db.js` FAQ (٧) · إنستغرام (٤) · bulk (٤) · حجوزات (٣) · إحصاءات (٦) · كتالوج/مراجعة | `domain/{faq,instagram,bulk,booking,analytics,catalog,review}.js` |
| `db.js:resetMerchantQuota` | `domain/quota.js` (مع `meter.js`) |
| `api/copy.js` (١٤ تصديراً) | `domain/copy.js` — يبقى endpoint ~٤٥ سطراً |
| `api/chat.js` بناء النظام | `domain/conversation.js` |
| `api/whatsapp/webhook.js:autoReply` (٢٢٠ سطراً) | `domain/whatsapp.js` — يبقى الويبهوك ~٦٠ سطراً |
| `api/cron/bulk_process.js` (٣ مراحل) | `domain/bulk.js` |
| `api/auth/*` (٢٠ استعلاماً) | `domain/auth.js` — كل ملف auth تحت ٨٠ سطراً |
| `services/*` | `domain/*` بـre-export مؤقت من `services/` |
| `extractBalancedJson` (`copy.js`) | `ai/parseModelJson.js` — يستخدمه `chat.js` أيضاً |
| `integrations/dlq.js` · `ai/typoCorrector.js` · `_lib/*/index.js` · ٣٥ تصديراً ميتاً | حذف |
| `dashboard.html` JS (١٤٢٤ سطراً) | `public/js/dashboard/{api,render,tabs}.js` + `partials/dashboard-tab-*.html` |
| `sleek-*`/`wire-btn` (٣ قيم متعارضة) | `styles/08-shared-components.css` |
| `agents.html`/`agent-studio.html` (معزولتان، روابط مكسورة) | ربط من `index.html` + `_redirects` أو أرشفة |

## ٣. مراحل البناء (بالمخاطرة تصاعدياً)

| # | المرحلة | المخاطرة | الإثبات | الحارس الذي يُفعَّل |
|---|---|---|---|---|
| ١ | **حراس + تنظيف الموت:** ٥ سكربتات تدقيق (§٤) بقوائم سماح تتقلّص · حذف الميت · `core/limits.js` · مشغّل اختبارات موحّد | صفر | `npm test` كما هو | `audit-dead-exports` · `audit-file-size` · `audit-layering` · `audit-migrations` · `audit-frontend` |
| ٢ | **الواجهة (١-٣):** `_redirects` + ربط/أرشفة الصفحتين · CSS موحّد · `partials/head-common` مستخدم فعلاً · `public/js/shared.js` | منخفضة | `npm run build && verify:dist` + اختبار نصي | `audit-frontend` يقلّص سماحه |
| ٣ | **تقطيع `db.js` → `domain/*`** بـre-export shim (صفر تعديل على الـ٤٠ مستورداً) · `services→domain` · إزالة `respond.js` من domain · `integrations/salla.js` بلا D1 | متوسطة | `npm test` + `audit-isolation` بلا تعديل | `audit-layering` صارم |
| ٤ | **إفراغ `api/*`:** auth · copy · chat · bulk_process · الـ١٨ معالجاً الخام → `withApi`/`withApi.raw` | متوسطة | smoke + اختبارات وحدة المرحلة ١ | `audit-layering` يرفض `.prepare(` بـapi · `audit-file-size` سقف ٨٠ |
| ٥ | **تقسيم `dashboard.html`** إلى partials + `public/js/dashboard/*` · تقسيم الاختبارات `tests/unit/*` | متوسطة | build + فتح كل تبويب + نفس عدد التأكيدات | `audit-frontend` سقف ٨٠٠ سطر |
| ٦ | **`whatsapp/webhook.js` → `domain/whatsapp.js`** · توصيل أو حذف مسار إرسال إنستغرام الميت · إزالة shim `db.js` | الأعلى | اختبار التوقيع + بوابات التصعيد + نافذة الصمت قبل/بعد | كل الحراس بلا قوائم سماح |

## ٤. الحراس الآلية (داخل `npm test`، لا داخل `deploy`)

| السكربت | يفشل عند |
|---|---|
| `audit-dead-exports.mjs` | تصدير بـ`_lib/**` بلا مستورد (قائمة سماح مؤقتة للواجهات العامة الموثّقة) |
| `audit-file-size.mjs` | `api/*` > ٨٠ سطراً، `_lib/*` > ٤٠٠، `*.html` > ٨٠٠ — بقائمة سماح مؤرَّخة تتقلّص كل مرحلة، ويفشل لو **كبر** ملف مسموح |
| `audit-layering.mjs` | استيراد بالاتجاه الخاطئ (§١) · `.prepare(` أو بناء prompt داخل `api/**` |
| `audit-migrations.mjs` | عمود بـSQL الكود لا توجد له هجرة · جدول بهجرة لا يذكره الكود · هجرة بالملفات غير مطبَّقة (يقرأ `wrangler d1 migrations list` عند توفره) |
| `audit-frontend.mjs` | دالة JS معرّفة بأكثر من صفحة بمحتوى مختلف · رابط داخلي لصفحة غير موجودة · صنف CSS مستخدم غير معرّف · صفحة تتجاوز سقفها |
| `run-tests.mjs` | يجمع `tests/**/*.test.mjs`، لا يتوقف عند أول فشل، ملخص واحد |

**قاعدة القائمة البيضاء:** كل استثناء له سطر بالسكربت بتاريخ وسبب ومرحلة الإزالة. لا يُضاف استثناء جديد إلا بتعليق مبرَّر — والحارس يفشل لو زاد عدد الاستثناءات عن العدد المكتوب.

## ٥. نتيجة التنفيذ — المراحل الست منفَّذة ومنشورة (2026-09-09)

| المقياس | قبل | بعد |
|---|---|---|
| `core/db.js` | ١٣٥١ سطراً، ٨٤ تصديراً، ٩ مجالات، ٤٠ مستورداً | **محذوف** — ٢٤ ملف مجال، أكبرها ٣٩١ سطراً |
| استعلامات SQL خام بـ`api/**` | ٤٠ | **صفر** |
| بناء system prompt بـ`api/**` | ٦ مواضع | **صفر** (`ai/prompts/*`) |
| أكبر ملف `api/**` | ٥٦٧ سطراً | **٨٠** |
| `dashboard.html` / `admin.html` | ١٩٤٣ / ٩١٦ | **٤٣ / ٤٠** (قوالب + وحدات ES ≤ ٣٠٨) |
| تصديرات ميتة | ٣٥ + ملف تكامل كامل | **صفر** (٣٣٤ تصديراً مفحوصاً) |
| واجهات مؤقتة (shims) | — | **صفر** (`db.js`، `services/` حُذفا) |
| `integrations/*` تلمس D1 | `salla.js` | **صفر** — HTTP خالص، التوكن يُمرَّر |
| مسار إرسال إنستغرام | ميت | موصول (`send()` + تجديد التوكن كل تِك) |
| ملفات الاختبار / التأكيدات | ١ (٣٢٠٠ سطر) / ٤٥٣ | **٣١** (`unit/` ٢٤ + `integration/` ٦ + الواجهة) / **١٠١٠** |
| الحراس داخل `npm test` | ٢ | **٨** بقوائم سماح **صفرية** (عدا ٨ جداول legacy — قرار مالك بـ`DEFERRED.md`) |
| مزوّد خطوط خارجي معطّل (500 بكل صفحة) | `fonts.cdnfonts.com` | أُزيل، خط واحد موحّد من Google Fonts |

**قواعد الاتجاه المفروضة آلياً (ق١–ق٦):** core لا يستورد الأعلى · integrations بلا D1/domain · domain بلا HTTP · api بلا SQL/prompt · api لا يستورد integrations (يمر بالمجال) · ملفات فوق السقف = فشل.

| درجة الصحة المعمارية | الخلفية | الواجهة |
|---|---|---|
| قبل (تدقيق مستقل) | ٥٨ | ٤٨ |
| بعد الست (تقدير المنسّق بنفس معايير المدقق: اتجاه ٢٥ · تماسك ٢٥ · نظافة api ٢٠ · موت ١٠ · اختبارات ١٠ · مخطط ١٠) | **~٩٣** (خصم: جداول legacy، `tenant-audit-ok` تعليقات لا فحص AST) | **~٨٨** (خصم: Tailwind عبر CDN بالإنتاج، معالجات onclick على window) |

**ما يمنع العودة للنمو العشوائي:** أي ملف جديد يخرق سقفاً أو اتجاهاً أو يترك تصديراً بلا مستورد يُسقط `npm test` — لا يعتمد على انتباه المطوّر.

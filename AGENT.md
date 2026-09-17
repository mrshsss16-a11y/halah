# AGENT.md — دليل بنية مشروع هالة لأي وكيل ذكاء اصطناعي

> اقرأ هذا الملف كاملاً قبل أي تعديل. آخر مزامنة شاملة مع الكود: **2026-09-17** (موجة التحصين A).
> قاعدة القارئ: **تحقّق من أي سطر هنا بـ`ملف:سطر` قبل الاعتماد عليه** — الوثائق تفوت التحديث.

---

## ١. ما هو المشروع

منتجان مبنيان على نفس المستودع والبنية التحتية، ولا يُخلطان:

**أ) «هالة سلة» — كتابة أوصاف المنتجات.** تطبيق داخل متجر سلة (Easy Mode): يسحب منتجات
التاجر، يقرأ صور المنتج، ويكتب وصفاً عربياً قابلاً للنشر مباشرة. **قيد المراجعة من سلة**؛
اجتماع المراجعة **2026-10-06**. هذا هو المنتج المعروض اليوم بلوحة التاجر.

**ب) «هالة» — شات بوت/وكيل تواصل خارج سلة.** ردود على واتساب وودجت الموقع بلهجة سعودية
بيضاء تمثّل **أورا للتسويق** (وكالة سعودية بمكة): تجاوب، تحجز استشارات، تُصعّد للبشر.
**ميتا وافقت 2026-09-15**، لكن المنتج **غير مُظهَر** للتجار (تبويب واتساب والودجت مخفيان
حتى بعد قبول سلة). الكود حيّ ومختبَر، والعرض فقط هو المؤجَّل.

قواعد المنتجين: الشخصية لا تذكر سعراً أبداً (§٥)، ولا استيراد متبادل بين مساري المنتجين،
وأي ادعاء بأن ميزة «نشطة» يجب أن يطابق ما يفعله الكود فعلاً (§٥ قاعدة الصدق).

---

## ٢. البنية التقنية — كل شيء على Cloudflare

| الطبقة | التقنية |
|---|---|
| الاستضافة | Cloudflare Pages (مشروع `hala-ai-os`، فرع الإنتاج **`main`**، دومين `halah.aura.sa`) |
| الواجهة | HTML ثابت بجذر المستودع + `partials/` عبر `#include` → `scripts/stage.mjs` |
| الـAPI | Pages Functions: `functions/api/**` → `/api/*` (٥٧ ملف endpoint) |
| توليد النصوص | AI Gateway متعدد الطبقات (`functions/_lib/ai/gateway.js`) — §٨ |
| قراءة الصور | `functions/_lib/ai/vision.js` + `domain/visionFacts.js` (كاش حقائق) — §٨ |
| ذاكرة RAG | Vectorize `halah-tr-faq` (`@cf/baai/bge-m3`، عزل بـmetadata `storeId`) |
| قاعدة البيانات | D1 `halah-tr-db` (`4d8955ff-f2db-4447-8817-fe1149cce582`)، هجرات `0001..0031` |
| كاش + حدود معدّل | KV `HALA_CACHE` |
| الـcron | Worker منفصل `cron-worker/` كل ١٠ دقائق يضرب `api/cron/*` بـ`CRON_SECRET` (Pages بلا cron) |

Bindings بـ`wrangler.toml`: `AI`, `VECTORIZE_INDEX`, `DB`, `HALA_CACHE`.
**قرار محسوم:** HTML ثابت + `functions/`. **لا Astro** ولا أي أداة تنتج `dist/_worker.js` (§٤).

---

## ٣. خريطة المجلدات والعقد المعماري

العقد الكامل: **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** — الشجرة المستهدفة، اتجاه
التبعيات (ق١–ق٦)، والحراس التي تفرضها. ما يلي خريطة تنقّل فقط.

```
functions/
  _lib/
    core/          بنية تحتية فقط، صفر منطق أعمال: respond · errors · errorLog · session · identity
                   csrf · crypto · cors · rateLimit · security · oauthState · adminEmails · auditLog
                   heartbeat · limits · meter
    domain/        منطق الأعمال، ملف لكل مجال، لا يعرف HTTP: auth · accounts · salla · sallaWelcome
                   whatsapp · whatsappAutoReply · whatsappInbound · whatsappConnect · bulk · bulkTick
                   catalog · catalogSync · review · reviewGuards · publish · copy · copyParse · copyPhrases
                   conversation · support · storeProfile · storeOverview · sallaProductPayload · quota
                   faq · booking · analytics · health · instagram · persona · platforms · merchantPurge
                   visionFacts · auraAgent
    integrations/  محوّلات HTTP خالصة (صفر D1): salla · whatsapp · instagram · email
    ai/            gateway · nexos · vision · parseModelJson · guards · persona (المصدر الوحيد)
                   prompts/{seo,chat,support,whatsapp,instagram} · memory · intents · productTaxonomy
                   attributeDictionary · decisionQuestions · supportPlaybook
  api/**           تنسيق فقط (≤٨٠ سطراً، صفر SQL، صفر prompt، لا يستورد integrations)
cron-worker/       Worker مستقل */10
partials/          head-common · dashboard-* · admin-*   (#include بـstage.mjs)
public/js/         shared.js · dashboard/*.js · admin/*.js
styles/            01..08 تُدمج في dist/style.css
migrations/        0001..0031 — §٦
persona/           مولَّد آلياً من ai/persona.js (scripts/export-persona.mjs) — لا يُحرَّر يدوياً
tests/             unit/ (٨١ ملفاً) · integration/ (٦ موجات) · frontend.test.mjs · _helpers.mjs
scripts/           §١١
```

**الحراس (قوائم سماح صفرية، كلها داخل `npm test`):** ملف `api` فوق ٨٠ سطراً، أو `_lib` فوق
٤٠٠، أو HTML فوق ٨٠٠ · استيراد بالاتجاه الخاطئ (ق١–ق٦) · تصدير بلا مستورد · عمود بلا هجرة ·
`innerHTML` غير مهرَّب · `resolveStoreId` بلا تبرير · `console.*` بقيمة ديناميكية خارج
`errorLog.js` (ح١١) · بايت NUL خام (ح١٢).

---

## ٤. البناء والنشر — مسار واحد فقط

```bash
npm run deploy   # deploy:guard → npm test → build → verify:dist → wrangler --branch=main → smoke
```

- **انشر بـ`npm run deploy` فقط.** لا `wrangler pages deploy` يدوياً: تتخطى الحراس والدخان.
- `deploy:guard` (`scripts/check-wrangler-account.mjs`) يقارن حساب Cloudflare بالمتوقَّع
  (`d1d225ac2dc19ecc3942e26056e6478c`) ويوقف النشر عند أي فرق — منع النشر بحساب خاطئ.
- **حارس الهجرات (م٣ بـ`audit-migrations.mjs`) يحجب النشر عند وجود هجرة غير مطبَّقة على
  البعيد.** الحل قبل النشر لا تعطيل الحارس:
  ```bash
  npx wrangler d1 migrations apply halah-tr-db --remote
  ```
- **لا تُدخل Astro.** `astro build` ينتج `dist/_worker.js` فيحوّل Pages لـAdvanced Mode
  ويتجاهل `functions/` كاملاً — أسقط كل الـendpoints إلى 404 فعلاً (2026-07-31)، بما فيها
  ويبهوك واتساب وتسجيل الدخول. `scripts/verify-dist.mjs` يمنعه آلياً؛ لا تُعطّله.
- **بلا `--branch=main`** يذهب النشر لفرع Preview ولا يراه أحد على الدومين الحي.
- **لا `_redirects` بقواعد `/x /x.html 200`** — Pages يخدم المسارات النظيفة تلقائياً،
  والقاعدة تُنتج حلقة 308 لا نهائية (أسقطت `/dashboard` داخل إطار سلة 2026-09-09).

### التحقق الإلزامي بعد كل نشر

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://hala-ai-os.pages.dev/api/health                 # 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST .../api/whatsapp/webhook   -d '{}'              # 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST .../api/webhooks/salla     -d '{}'              # 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST .../api/whatsapp/webhook   --data-binary @1mb   # 413
curl -sI https://halah.aura.sa/admin | grep -iE 'cache-control|x-robots-tag'   # no-store + noindex
```
ثم **يدوياً**: توليد وصف حيّ من لوحة التاجر (يثبت أن مسار AI كامل يعمل)، ومراجعة
`/api/admin/errors` (جدول `error_log`) بحثاً عن أخطاء جديدة. 404 على أي فحص = الـAPI ساقط.

---

## ٥. قواعد لا تُكسر

### البناء
- النشر بـ`npm run deploy` فقط، على `--branch=main`، وبعد تطبيق كل هجرة.
- لا أداة تنتج `_worker.js` أو `_routes.json` بـ`dist/`.
- سقوف الأحجام والحراس ليست اقتراحاً: لا قائمة سماح، لا تعطيل، لا `// eslint-disable` مكافئ.

### الأمن
- **لا أسرار بالكود ولا قيم افتراضية للأسرار.** غياب السر = رمي خطأ (fail closed)، لا
  «تمرير برشاقة». ثلاث ثغرات مصادقة حرجة نشأت من كسر هذه القاعدة وأُغلقت (commit `47f569b`).
- لا باب خلفي، لا كلمة مرور بالكود، لا تجاوز مصادقة بأي علم بيئة.
- لا تثق بهوية يرسلها العميل (بريد/معرّف/`phoneNumberId`) — تحقق منها من مصدرها بالتوكن.
- الجلسة كوكي HMAC `merchantId.expiry.sessionVersion.hmac`؛ `resolveStoreId` يجعل الجلسة
  تتغلب دائماً على أي `storeId` يدّعيه العميل.
- تواقيع الويبهوكس (`X-Salla-Signature`, `X-Hub-Signature-256`) مقارنة ثابتة الزمن، ورفض
  401 صارم؛ `state` بتدفقات OAuth إلزامي. لا تُضعَّف أي منها.
- `requireAdmin` يقارن بـ`ADMIN_EMAILS` فقط — **لا عمود `is_admin`** بالقاعدة عمداً.

### الصدق
لا بيانات مفبركة تُعرض كأنها حقيقية: لا أسعار مخترعة، لا طلبات/عملاء وهميون، لا ادعاء
«نشط» لنظام غير مضبوط، لا ادعاء امتثال قانوني. ينطبق على الكود التجريبي أيضاً.

### الشخصية
مصدر واحد: `functions/_lib/ai/persona.js` (`HALA_WHATSAPP_SUPPORT_PROMPT` للواتساب،
`HALA_SUPPORT_PROMPT` للموقع)؛ عدّل معه النسخة المرجعية بـ`persona/` عبر `export-persona.mjs`.
**البوت ممنوع يذكر أي رقم سعر** — يوجّه للاستشارة المجانية. `DISABLE_ESCALATION_GATES`
يبقى `false` بالإنتاج؛ عند التصعيد أو رد بشري يصمت البوت ساعتين.

---

## ٦. دروس لا تتكرر

| التاريخ | العرض | السبب | القاعدة |
|---|---|---|---|
| 2026-07-31 | كل الـ٥٦ endpoint 404 بالإنتاج | `dist/_worker.js` من Astro حوّل Pages لـAdvanced Mode | لا تُدخل أداة تنتج `_worker.js`؛ أبقِ `verify-dist` فعّالاً |
| 2026-07-31 | ثلاث ثغرات مصادقة | أسرار بقيم افتراضية «كي لا ينكسر التشغيل» | لا قيمة افتراضية لسر — غيابه يرمي خطأ |
| 2026-09-09 | `/dashboard` داخل سلة بحلقة 308 | `_redirects` بقاعدة `/x /x.html 200` | لا `_redirects` لمسار نظيف |
| 2026-09-06 | ٦ بنود دَين موثّقة وهي مُصلَحة، وبند مُصلَح وهو ليس كذلك | نقل بين نسخ الوثيقة بلا تحقق | لا تنقل بنداً بلا `ملف:سطر` يثبته اليوم |
| 2026-09-06 | `[observability]` أسقط النشر | Pages يرفض المفتاح (Workers-only) | لا تُعِده؛ التسجيل عبر `error_log` + `/api/admin/errors` |
| 2026-09-08 | تذكرة برقمين مختلفين ورقم موظف مفبرك | مصدران للرقم + قيمة افتراضية | مصدر واحد للبيانات؛ غياب `STORE_WA_PHONE` = تخطٍّ مُسجَّل لا رقم مخترع |
| 2026-09-12 | تاجر واحد استهلك سعة اليوم للجميع | حصة شهرية بلا حد يومي | الحصص يومية للموارد المتجددة يومياً + سقف عام فوقها |
| 2026-09-14 | أوصاف أزياء ناقصة الوصف | قراءة مجانية للصور بفئات دقيقة | فئات الأزياء تُقرأ بـLuna أولاً، والقراءة تُحفظ (`vision_facts`) |
| 2026-09-17 | ملفات وكلاء آخرين رجعت للخلف | وكيل شغّل `git stash` في شجرة عمل مشتركة | ممنوع `stash/checkout/reset/clean` بشجرة مشتركة؛ الحزم المتوازية بـworktree معزول |
| 2026-09-17 | اختبار N9-2 على `_headers` انكسر بلا تغيير منطقي | أداة تحرير حوّلت LF↔CRLF | حافظ على نهايات الأسطر وتحقق بـ`file` بعد كل تعديل |
| 2026-09-17 | تعبير regex بـJS انكسر | heredoc بايثون حوّل `\n` داخله إلى سطر حقيقي | عدّل التعابير بأداة Edit لا بسلاسل مُفسَّرة بصدفة/heredoc |
| 2026-09-17 | النشر متوقف (`audit-migrations` م٣) | هجرة جديدة غير مطبَّقة على البعيد | طبّق `wrangler d1 migrations apply --remote` قبل `npm run deploy` |
| 2026-09-17 | متغير بيئة بقيمة فيها مسافة زائدة | `set X=val && …` بـcmd يُدخل المسافة | استخدم `set "X=val"` أو PowerShell أو `env -u` |
| 2026-09-17 | `gateway.js` عُومل كملف ثنائي (grep لا يقرأه) | بايت NUL حرفي داخل قالب مفتاح الكاش | لا بايتات تحكم خام بالمصدر؛ استخدم الهروب `\u0000` (حارس ح١٢) |
| 2026-09-17 | 429 من Tier-0 nexos بالتوليد الجماعي | نداءات متوازية على مزوّد بحد معدّل | التوليد الجماعي تسلسلي من الصفحة |
| 2026-09-17 | التوليد توقف للتجار بعد نشر سليم | كاش الحافة خدم HTML قديماً مع JS جديد | لوحة التاجر `no-store` + قاعدة Bypass للكاش على `halah.aura.sa` |
| 2026-09-17 | تجاوز الحد اليومي بطلبين متوازيين | العدّاد KV «اقرأ ثم اكتب» غير ذرّي | العدّادات الحرجة ذرّية بـD1 (`INSERT … ON CONFLICT … WHERE`) |
| 2026-09-17 | تاجر جدّد اشتراكه فتعطّل حسابه | `app.trial.expired` كان يحذف التوكنات | الانتهاء **إيقاف** لا حذف — لا تُتلف بيانات على حدث دورة حياة |
| 2026-09-17 | رقم واتساب تاجر قابل للاستيلاء | `phoneNumberId` من جسم الطلب بلا إثبات ملكية | تحقق من العضوية بـ`GET /{wabaId}/phone_numbers` قبل الربط |
| 2026-09-17 | احتمال تسريب مفتاح للسجل | `console.warn(e.message)` بجسم خطأ مزوّد | كل تسجيل عبر `logError`/`sanitizeInternal` (حارس ح١١) |
| 2026-09-17 | ويبهوك بلا سقف حجم ولا منع تكرار | HMAC يُحسب على جسم غير محدود، وإعادة الإرسال تُعالَج مرتين | سقف ~512KB قبل HMAC + dedupe بـKV لكل ويبهوك |
| 2026-09-17 | حذف حساب لا يمسح كل أثره | جداول مفتاحها البريد خارج `merchantPurge` | كل جدول جديد يُسجَّل بمسار الحذف فوراً |
| 2026-09-17 | نداءات خارجية قد تعلّق للأبد | لا `AbortSignal.timeout` على أي fetch | كل fetch خارجي بمهلة ٨–١٥ ثانية |
| 2026-09-17 | مفاتيح KV تتراكم بلا نهاية | كتابة KV بلا TTL | كل مفتاح KV بـTTL صريح (اختبار `kv-ttl`) |
| 2026-09-17 | مسح كامل للجدول كل تِك cron | استعلام تجميعي بلا فهرس | فهرس قبل أي `GROUP BY` بمسار cron |
| 2026-09-17 | ملفات على بُعد سطر من سقف ٤٠٠ | نمو بلا قسمة | اقسم عند ٣٩٠ (تحذير `file-size`) بإعادة تصدير `export {…} from` — صفر تعديل مستوردين |
| 2026-09-17 | اختبارات تنكسر من إعادة تنسيق | ٤١ اختباراً يقرأ المصدر بـ`readFileSync` | لا `readFileSync` باختبار جديد — اختبر السلوك باستيراد الوحدة |
| 2026-09-17 | وثيقة تصف ما لم يعد صحيحاً | ميزة شُحنت بلا تحديث AGENT.md | أي ميزة/سر/حصة جديدة تُحدَّث هنا بنفس الدفعة |
| 2026-09-17 | تدوير مفتاح يضرب المنتجين معاً | مفاتيح AI مشتركة بين «هالة سلة» و«هالة» | سجّل التدوير بجدول §١٠ وبلّغ قبل أي تدوير مشترك |
| 2026-09-17 | لا مسار لتدوير `ENCRYPTION_KEY` | تشفير بإصدار واحد بلا `enc:v2` | لا تُدوّر `ENCRYPTION_KEY` قبل شحن `enc:v2` — التدوير اليوم يسقط كل توكنات المتاجر |

---

## ٧. كيف تضيف

**endpoint جديد** ①`functions/api/<مسار>.js` ≤٨٠ سطراً ②`withApi()` للتحقق وCSRF
③صفر SQL وصفر prompt — استدعِ `domain/` ④لا تستورد `integrations/` مباشرة ⑤أعد `json()` من
`core/respond.js` ⑥اختبار عقد بـ`tests/unit/` ⑦`npm test` ⑧حدّث §٣ إن أضفت مجالاً.

**مجال (domain) جديد** ①ملف واحد بـ`functions/_lib/domain/` ②صفر `Response` وصفر HTTP
③يستورد `core/` و`integrations/` فقط، لا `api/` ④≤٤٠٠ سطر (اقسم عند ٣٩٠) ⑤لا يستورد أكثر
من ١٠ أشقاء ⑥اختبار سلوك باستيراد الوحدة ⑦أضِف الاسم لـ§٣.

**تبويب/ميزة واجهة (partial + js)** ①`partials/dashboard-<اسم>.html` ②`public/js/dashboard/<اسم>.js`
③سجّل الدوال على `window` من `main.js` وحده (لا `onclick` يشير لدالة غير مسجَّلة)
④`#include` بالصفحة ⑤الأصناف من `styles/08-shared-components` ⑥`escHtml` لأي نص من المستخدم
⑦اختبار بـ`tests/frontend.test.mjs` ⑧`npm test` (حارس `audit-frontend`).

**هجرة** ①`migrations/00NN_<اسم>.sql` بترقيم متسلسل ②`npm run backup` قبل أي تغيير مدمِّر
③`npx wrangler d1 migrations apply halah-tr-db --remote` ④حدّث الكود ليستخدم العمود/الجدول
⑤أضِف الجدول لمسار الحذف (`domain/merchantPurge.js`) ⑥`npm test` (م١/م٢/م٣) ⑦لا تنشر قبل
نجاح م٣.

**سر جديد** ①استعمله بـ`env.NAME` بلا قيمة افتراضية، والغياب يرمي أو يعطّل الميزة بصدق
②`npx wrangler pages secret put NAME --project-name hala-ai-os` ③أضِفه لجرد §١٠ بتصنيفه
④وثّق أثر غيابه ⑤إن كان يُخزَّن بالقاعدة فبتشفير `core/crypto.js` (حارس ح٩) ⑥اختبار
fail-closed ⑦لا تطبع قيمته بأي سجل.

**اختبار** ①`tests/unit/<موضوع>.test.mjs` ②استورد الوحدة واختبر سلوكها — **لا `readFileSync`
على المصدر** ③استخدم `createRunner`/`fakeKv` من `tests/_helpers.mjs` ④أكّد الحالة السلبية
(رفض/401/حد) لا الإيجابية وحدها ⑤اسم التأكيد يحمل معرّف البند ⑥`npm test` كاملاً.

**حارس جديد** ①`scripts/audit-<اسم>.mjs` يمشي الشجرة نصياً ②تحذير أولاً (طباعة بلا فشل)
حتى تُنظَّف المخالفات القائمة ③ثم صارم بقائمة سماح صفرية ④رسالة الفشل تقول **ماذا تفعل**
⑤أضِفه لـ`npm test` و`npm run check` بـ`package.json` ⑥اختبار للحارس نفسه ⑦اذكره بـ§١١.

**قسمة ملف بإعادة تصدير** ①انقل الكتلة لملف جديد بنفس المجلد ②`export {…} from "./new.js"`
بالملف الأصلي — صفر تعديل بأي مستورد ③لا تغيّر أي توقيع دالة ④`npm test` يجب أن يمر بلا
تعديل اختبار ⑤الملفات الحساسة (`salla.js`, `session.js`, `meter.js`) كل واحد بنشر منفصل
⑥بعد النشر: `curl` + توليد حيّ ⑦`graphify update .`.

**تكامل خارجي** ①`functions/_lib/integrations/<اسم>.js` بعقد `isConfigured/send/receive`
②صفر D1 وصفر منطق أعمال ③`AbortSignal.timeout` على كل fetch ④تحقق توقيع + سقف حجم +
dedupe لأي ويبهوك ⑤الأسرار fail-closed و§١٠ ⑥الميزة مخفية بصدق عند غياب السر ⑦اختبار
يثبت الرفض بلا توقيع.

**درس** ①أضِف صفاً لجدول §٦ بالتاريخ والعرض والسبب ②القاعدة بصيغة الأمر ③إن أمكن فرضها
آلياً أضِف حارساً أو اختباراً ④اربطها بالبند بالباكلوج ⑤لا تحذف صفاً قديماً — الجدول يكبر.

---

## ٨. مرجع الحصص والطبقات

**الحصص (`functions/_lib/core/meter.js`):**

| الدلو | الحد | النطاق |
|---|---|---|
| `description` | **٥ يومياً** لكل متجر | `DAILY_BUCKET_LIMITS` |
| `description` (عام) | **٢٥ يومياً** للمشروع كله | `GLOBAL_DAILY_LIMITS` — **حد إطلاق** يُرفع بقرار موثَّق |
| `message` | ٣٠٠ شهرياً | `MONTHLY_BUCKET_LIMITS` |
| `image` | ٢٠ شهرياً | `MONTHLY_BUCKET_LIMITS` |

الإعفاء: `hala` ثابت بالكود (خط أورا التشغيلي) + `UNMETERED_MERCHANT_IDS` (متغير بيئة،
مطابقة تامة بعد التشذيب). الإعفاء للحصة وحدها — حدود المعدّل تبقى سارية. العدّاد D1 هو
مصدر الحقيقة (`INSERT … ON CONFLICT`)، وKV طبقة تسريع بـTTL ٢٥ ساعة/٣٢ يوماً.

**تعاقب النص (`ai/gateway.js`)** — كاش KV أولاً (`ttlKind`: `copy` ٢٤س، `chat` ١٥د):

1. **Tier 0 — nexos.ai (GPT 5.6 Luna)** للأوصاف فقط (`ttlKind === "copy"`) بسقف يومي
   (`ai/nexos.js` / `reserveNexosCall`). **المحادثة والدعم لا يمران من nexos إطلاقاً.**
2. Cloudflare Workers AI → 3. Groq → 4. Gemini → 5. OpenRouter →
   Tier 5: nexos مرة أخيرة إن لم يُجرَّب بالطبقة ٠ (للأوصاف فقط).

**الرؤية (`ai/vision.js` + `domain/visionFacts.js`):** فئات الأزياء (`womens_apparel`,
`abayas` — قراءة منظّمة) تذهب لـ**Luna أولاً**؛ غيرها **Qwen 3.8 على Workers AI** (ثم Groq
وOpenRouter)، ومع قراءة ناقصة (`visionTextIsThin`) تُصعَّد مرة واحدة لـLuna. النتيجة تُحفظ
بـ`vision_facts` بمفتاح `FACTS_VERSION` الحالي **`v4`** فلا تُدفع القراءة مرتين.

---

## ٩. حالة التكاملات

| التكامل | الحالة |
|---|---|
| **سلة** | Easy Mode مفعّل: OAuth + ويبهوك موقّع، وعند `app.installed` يُنشأ حساب التاجر ويُرسَل بريد ترحيب (`domain/sallaWelcome.js`؛ فشله لا يُسقط التثبيت). التطبيق **قيد المراجعة**. |
| **Resend (البريد)** | مفعّل على دومين `send.aura.sa` — استعادة كلمة المرور وتحقق البريد والترحيب. غياب `RESEND_API_KEY` = 503 صريحة (fail-closed). |
| **Google Sign-In** | مفعّل (`auth/google.js`، تحقق `aud` + `email_verified`). |
| **واتساب** | الكود كامل ومختبَر، **ميتا وافقت 2026-09-15**، والتبويب **مخفي** عن التجار. `WA_SIGNUP_CONFIG_ID` غير مضبوط ⇒ Embedded Signup معطّل بصدق. |
| **إنستغرام** | مبني (ويبهوك + محوّل) **وغير مفعّل**. |
| **صفحة الأسعار** | `pricing.html` موجودة لكن **الرابط مخفي** من الواجهة و`noindex` حتى قبول سلة وتفعيل الباقات بالكود. |

---

## ١٠. الأسرار والمتغيرات

جرد مُولَّد 2026-09-17 من:
`grep -rhoE 'env\.[A-Z_]+|env\?\.[A-Z_]+' functions cron-worker | sort -u`
إضافة سر: `npx wrangler pages secret put NAME --project-name hala-ai-os`. **لا تطبع قيمة سر أبداً.**

### إلزامية (الغياب = رمي خطأ / رفض صريح)
`SESSION_SECRET` (توقيع الجلسة وCSRF) · `ENCRYPTION_KEY` (تشفير `oauth_tokens.*`,
`platform_connections.*`, `wa_connections.business_token`, `ig_connections.access_token` —
حارس ح٩) · `ADMIN_EMAILS` · `SALLA_APP_ID` · `SALLA_CLIENT_ID` · `SALLA_CLIENT_SECRET` ·
`SALLA_WEBHOOK_SECRET` · `WHATSAPP_TOKEN` · `WHATSAPP_PHONE_ID` · `WHATSAPP_VERIFY_TOKEN` ·
`WHATSAPP_APP_SECRET` · `CRON_SECRET` (بدونه `api/cron/*` ترفض 500 `CRON_NOT_CONFIGURED`).

### اختيارية (الغياب يعطّل ميزة بصدق، لا يكسر التشغيل)
`NEXOS_API_KEY` (Tier 0 للأوصاف) · `GROQ_API_KEY` · `GEMINI_API_KEY` · `OPENROUTER_API_KEY` ·
`HF_TOKEN` (احتياطي `imageProvider.js`) · `RESEND_API_KEY` · `EMAIL_FROM` ·
`GOOGLE_CLIENT_ID` · `META_APP_ID` · `META_APP_SECRET` · `INSTAGRAM_APP_SECRET` ·
`INSTAGRAM_VERIFY_TOKEN` · `WA_SIGNUP_CONFIG_ID` ·
`TURNSTILE_SECRET_KEY` (**fail-open — دَين N7 موثّق، §١٢**).

### غير سرية (إعدادات بيئة)
`TRUSTED_ORIGINS` (قائمة سماح Origin إضافية بـ`core/csrf.js`) ·
`UNMETERED_MERCHANT_IDS` (إعفاء حصة مؤقت، §٨) · `WIDGET_ALLOWED_ORIGINS` ·
`STORE_WA_PHONE` · `MERCHANT_WA_PHONE` · `WHATSAPP_MERCHANT_ID` · `HALA_DEBUG_AI`.
**Bindings** (`wrangler.toml`، ليست أسراراً): `AI` · `VECTORIZE_INDEX` · `DB` · `HALA_CACHE`.

### سجل التدوير
| التاريخ | السر | السبب | مَن نفّذ |
|---|---|---|---|
| — | — | لا تدوير مسجَّل بعد | — |

> **تنبيه:** تدوير `ENCRYPTION_KEY` **يحتاج كوداً** (مخطط `enc:v2` + `ENCRYPTION_KEY_PREV`
> وإعادة تشفير خلفية). تدويره اليوم يُسقط كل توكنات المتاجر — SEC-ENC-1 بـ§١٢.
> مفاتيح AI (Groq/OpenRouter/nexos) **مشتركة بين المنتجين**: تدويرها يضربهما معاً.

---

## ١١. الاختبارات والسكربتات والحراس

```bash
npm test     # stage + run-tests + كل audit-* (بوابة النشر)
npm run check # نفس الشيء بلا بناء dist (أسرع أثناء التطوير)
npm run build · npm run verify:dist · npm run backup · npm run smoke · npm run deploy:guard · npm run dev
npx wrangler d1 migrations apply halah-tr-db --remote
graphify query "<سؤال>"   /   graphify update .   (بعد كل تعديل)
```

- **الحراس:** `audit-isolation` (عزل المتاجر) · `audit-security` (ح٢ ح٥ ح٦ ح٧ ح٨ ح٩ ح١٠ +
  **ح١١** `console.*` بقيمة ديناميكية خارج `errorLog.js` + **ح١٢** بايت NUL خام) ·
  `audit-dead-exports` · `audit-file-size` (سقف ٤٠٠ لـ`_lib`، **تحذير عند ٣٩٠**) ·
  `audit-layering` (ق١–ق٦) · `audit-migrations` (م١ أعمدة، م٢ جداول يتيمة من كتلة §٦،
  **م٣ هجرة غير مطبَّقة ⇒ يحجب النشر**) · `audit-frontend`.
- **سكربتات تشغيل:** `stage` · `verify-dist` · `run-tests` (حد أدنى للتأكيدات) ·
  `check-wrangler-account` (deploy:guard) · `backup-db` · `smoke-test` · `export-persona` ·
  `verify-wa-token`.
- **اختبارات حارسة بارزة:** `kv-ttl` (كل كتابة KV بـTTL) · `file-size-warning` ·
  `deploy-guard` · `log-guard`/`log-hygiene` · `fetch-timeouts` ·
  `whatsapp-connect-ownership` · `webhook-guard` · `secrets-at-rest` · `db-isolation`.

### النسخ الاحتياطي
`npm run backup` يصدّر D1 كاملة إلى `backups/` (خارج git) ويتحقق أن الملف يحوي
`CREATE TABLE accounts` وأن أسطره > ١٠٠ وإلا `exit 1`. **النسخ يدوي ومحلي فقط** — لا رفع
تلقائي لأي تخزين خارجي؛ القرار **بيد مالك المشروع**. لا اختبار استعادة آلي بعد.

### جداول بالمخطط لا يذكرها الكود
`scripts/audit-migrations.mjs` (م٢) يقرأ الكتلة أدناه **حرفياً** — مصدر واحد، لا نسخة
بالسكربت. لتغيير القائمة عدّل هنا فقط. حذف أي جدول من الإنتاج يحتاج نسخة احتياطية
متحقَّقاً منها + قرار مالك المشروع (`docs/DEFERRED.md`).

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

قبل أي ادعاء أن جدولاً موجود، تحقق فعلياً:
`npx wrangler d1 execute halah-tr-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"`

---

## ١٢. المشاكل المفتوحة

| المعرّف | البند | الأثر |
|---|---|---|
| **SEC-ENC-1** | لا مسار لتدوير `ENCRYPTION_KEY` (`enc:v2` + `ENCRYPTION_KEY_PREV` + إعادة تشفير خلفية) | التدوير اليوم يُسقط كل توكنات المتاجر |
| **N7** | `verifyTurnstileToken` fail-open عند غياب المفتاح | طبقة إضافية معطّلة بصمت — بلا موعد إغلاق |
| **SCALE-CRON** | `catalog_sync` صفحة واحدة و`publish` متجر واحد لكل تِك ١٠ دقائق | سقف ~١٤٤ متجراً/يوم للنشر — يحتاج تقسيماً بالهاش أو شرائح |
| **QUOTA-GLOBAL** | `GLOBAL_DAILY_LIMITS.description = 25` حد إطلاق | يخنق أول ١٠٠ متجر — يُرفع بقرار موثَّق قبل الإطلاق |
| **FE-SRI** | `cdn.tailwindcss.com` بلا SRI + CSP بـ`unsafe-inline` | تضمين Tailwind محلياً بـ`dist` هو الحل |
| **TEST-BRITTLE** | ٤١ اختباراً يقرأ المصدر بـ`readFileSync` | ينكسر من إعادة تنسيق — يُحوَّل لاختبار سلوك قبل أي قسمة |
| **SIZE-400** | خمسة ملفات على بُعد ١–٤ أسطر من سقف ٤٠٠ (`salla.js`, `copy.js`, `copyParse.js`, `catalog.js`, `review.js`) | أي سطر إضافي يكسر `npm test` — اقسم بإعادة تصدير (§٧) |

خارطة الإطلاق والأولويات: [`docs/ROADMAP.md`](docs/ROADMAP.md) · القرارات المؤجَّلة:
[`docs/DEFERRED.md`](docs/DEFERRED.md) · العقد المعماري: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

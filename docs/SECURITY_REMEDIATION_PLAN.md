# خطة الحماية — إصلاح تقرير 2026-09-05

**المرجع:** [SECURITY_AUDIT_2026-09-05.md](SECURITY_AUDIT_2026-09-05.md) — ٣١ بند (٤ حرجة، ١٠ عالية،
١٠ متوسطة، ٧ منخفضة).
**المبدأ:** دفعات صغيرة قابلة للنشر والرجوع، كل دفعة لها اختبار يثبت الإغلاق ويمنع الرجوع، بترتيب
الخطر. لا دفعة تكسر تدفقاً حياً (سلة/واتساب/الجلسات) — كلها محروسة باختبار قبل النشر.

**بوابة كل دفعة:** `npm test` أخضر + syntax check + `npm run deploy` + `curl` health=200 وwebhook=401
+ فحص حي للتدفق المتأثر بالمتصفح.

---

## الدفعة ١ — أوقف النزيف الحرج *(اليوم — استغلال مفتوح على الإنتاج)*

| بند | إصلاح | ملف | اختبار |
|-----|-------|-----|--------|
| **C1** Zid relay | **احذف المسار** — stub غير حي (لا واجهة، لا سر، مؤجَّل بالـROADMAP). لو أُحيي مستقبلاً يُبنى بتوقيع HMAC مثل سلة | حذف `functions/api/webhooks/zid.js` + إزالة `export * from './zid.js'` من `_lib/integrations/index.js` | `curl POST /api/webhooks/zid` = 404 |
| **C2+H7** حصة من مجهول | `resolveStoreId`: المعرّف المُدّعى لمجهول لازم يوجد بـ`merchants`؛ غيره → `default-store`. ارفض المعرّفات المحجوزة (`hala`) من مدخلات العميل | `functions/_lib/core/session.js` | اختبار: `storeId:"x_fake"` مجهول → لا يُقاس كمستأجر جديد؛ `"hala"` من العميل مرفوض |
| **C2** لا rate limit | `checkRateLimit` بأعلى `chat`/`copy`/`signup`/`bulk/upload` قبل أي عمل مكلف | ٤ ملفات | اختبار: الطلب ٢١ بدقيقة = 429 |
| **C4** تسرّب معرّف سلة | احذف fallback الـ٥ دقائق بـ`status.js` (الـonboarding يحمل المعرّف من الـredirect) | `functions/api/store/status.js` | اختبار: `status` بجسم فارغ بلا كوكي = `{linked:false}` لا معرّف متجر |
| **C3+H3+L5** XSS مخزّن | دالة `escapeHtml` + تطبيقها على كل `${...}` بجداول `admin.html` (٦٥٨–٦٨٢، ٧٤٦–٧٥٦) وقائمة فشل الدفعة `dashboard.html:633`. + `sanitizeInput` على `storeName` (signup + salla) و`contactName` (webhook) | `admin.html`, `dashboard.html`, `signup.js`, `webhook.js`, `db.js` | اختبار وحدة: `escapeHtml("<img>")` يهرب؛ فحص حي: تسجيل باسم `<img onerror>` يظهر نصاً بلوحة الأدمن لا ينفّذ |

**لماذا معاً:** الأربعة الحرجة كلها بلا مصادقة وحيّة. C3 وC1 لا يعتمدان على قرار منك؛ ننشرهم أول
يوم.

---

## الدفعة ٢ — إغلاق أسطح الويب المصادَقة

| بند | إصلاح | ملف |
|-----|-------|-----|
| **H1** CSRF | بـ`withApi`: ارفض POST/PUT/PATCH ما لم يبدأ `Content-Type` بـ`application/json` (يعيد preflight) + allowlist لـ`Origin` (`halah.aura.sa`، `hala-ai-os.pages.dev`، `*.salla.sa`). أبقِ `SameSite=None` | `functions/_lib/core/respond.js` (+ helper) |
| **H2** SSRF imageUrl | قبل التمرير: `new URL`، اشترط `https:`، ارفض IP literal/خاص، allowlist مضيفين (`*.salla.sa`, CDN). بالـfetch: `redirect:'error'` + `AbortSignal.timeout(5000)` + سقف بايتات | `copy.js`, `gateway.js` |
| **M5** بروكسيات CORS | احذف `api.allorigins.win` و`corsproxy.io` من `connect-src` | `_headers` |
| **H6** سكربتات بلا SRI | ثبّت نسخة Salla SDK + Tailwind + `integrity`+`crossorigin`، أو استضفهم بـ`dist/` واحذفهم من CSP | `dashboard.html`, `_headers` |
| **L4** جسم غير محدود | ارفض `Content-Length > ~1MB` بـ`withApi` قبل الـparse | `respond.js` |

**اختبار الدفعة:** طلب cross-origin بـ`text/plain` = مرفوض؛ `imageUrl` لـIP خاص = مرفوض؛ كل
التدفقات الحية (توليد وصف، نشر، شات، دخول) تشتغل بالمتصفح.

---

## الدفعة ٣ — صلابة الهوية والمصادقة

| بند | إصلاح | ملف |
|-----|-------|-----|
| **H5** تصعيد أدمن | صلاحية الأدمن عبر عمود `is_admin` صريح (توفير يدوي) لا "من يملك row بهذا البريد"؛ + تحقق بريد قبل تفعيل الحساب | `session.js`, migration, `signup.js` |
| **H4** تخمين OTP | عداد فشل لكل بريد (أعد `login_attempts`)، إبطال بعد ٥، رمز ≥٨ base32 | `forgot_password.js`, `reset_password.js` |
| **H10** قفل مقاعد | Turnstile إلزامي + `checkRateLimit` على signup (جزء منه بالدفعة ١) + تحقق بريد قبل احتساب المقعد | `signup.js` |
| **M1** استيلاء Google مسبق | عند ربط Google بحساب محلي غير مُتحقَّق: اطلب الباسورد أو فرض reset وأبطل القديم | `google.js` |
| **M2** لا إبطال جلسات | عمود `session_version` بالحمولة الموقّعة، يُرفع عند التعطيل/reset | `session.js`, `db.js`, migration |
| **M3** قفل دخول موجّه | اقفل بأزواج (بريد، IP) + تأخير أسّي بدل قفل الحساب | `db.js`, `login.js` |
| **M10** Turnstile مفتوح | اشترط التوكن + fail-closed عند غياب المفتاح | `support.js`, `login.js`, `security.js` |

---

## الدفعة ٤ — الذكاء الاصطناعي وحدود التكلفة

| بند | إصلاح | ملف |
|-----|-------|-----|
| **M4** علامات النموذج كأوامر | تحقق كل علامة (`[BOOK_SLOT]`...) مقابل مجموعة مغلقة + `WEEKLY_SLOTS.includes()`؛ غلّف رسائل العميل بفواصل "بيانات لا أوامر"؛ بوابة مخرجات قبل `sendWaText` ترفض أرقام عملة/أكواد خصم/شظايا النظام | `webhook.js` |
| **M6** كوبون من النموذج | كوبون فقط من حملة يفعّلها التاجر صراحة، مخزّن ومنتهي ولمرة واحدة — لا `HALA-<name>-10` مولّد | `chat.js` |
| **H9** وسائط قبل البوابة | token bucket لكل رقم بأعلى حلقة الرسالة قبل تنزيل/تفريغ الوسائط | `webhook.js` |
| **H8** سباق KV | D1 مرجع + KV يمنع فقط لا يمنح (أو Durable Object لاحقاً)؛ `await` الـput | `meter.js`, `rateLimit.js` |

---

## الدفعة ٥ — تنظيف وتصلّب

| بند | إصلاح |
|-----|-------|
| **M8** سر مكتوب | احذف `|| "hala-verify-secret"` — ارمِ خطأ عند الغياب. راجع أرقام واتساب الافتراضية |
| **M7** أسرار `.dev.vars` | دوّر توكن Meta ومفتاح OpenRouter (احترازي) — غير مُودَعين بـGit، لكن المجلد خزنة سيئة |
| **M9** إعادة ويبهوك سلة | خزّن توقيع الحدث بـKV بـTTL ٢٤س، ارفض المكرر |
| **L1** default-store مشترك | اعزل الديمو المجهول أو امنع الكتابة الدائمة له |
| **L2** X-Forwarded-For | احذف الـfallback (Cloudflare يضبط `cf-connecting-ip` دائماً) — طابق `image.js` |
| **L3** مقارنات التوقيت | استخدم `timingSafeEqual` لـ`CRON_SECRET` و`hub.verify_token` |
| **L6** HSTS | أضف `Strict-Transport-Security` لـ`_headers` |
| **L7** كتابة GET سلة | `checkRateLimit` + `signatureOk: false` |

---

## قواعد حاكمة للتنفيذ

1. **لا كسر تدفق حي** — كل دفعة تُختبر بالمتصفح على التدفق المتأثر قبل النشر (نفس منهج B4).
2. **fail-closed دائماً** — كل إصلاح سر/توكن يرمي عند الغياب، لا قيمة افتراضية (قاعدة `CLAUDE.md`).
3. **اختبار يمنع الرجوع** — كل بند حرج/عالٍ يحصل على اختبار بـ`tests/api.test.mjs` يعيد إنتاج
   العطل، فأي رجوع يكسر البناء (نفس نمط اختبارات العزل الـ٧ اللي أضفناها بـP0).
4. **كوميت لكل دفعة** — رسالة تشرح الثغرة والإصلاح، مرجعها بند التقرير.
5. **لا توسّع نطاق** — إصلاحات أمنية فقط؛ لا إعادة تصميم ولا ميزات ضمنها.

## الترتيب الزمني

```
الدفعة ١ (اليوم، حرجة) ──► الدفعة ٢ (ويب مصادَق) ──► الدفعة ٣ (هوية)
                                                          │
                            الدفعة ٤ (ذكاء/تكلفة) ◄───────┘
                                     │
                            الدفعة ٥ (تنظيف)
```

الدفعتان ١ و٢ تغلقان كل الحرجة وأغلب العالية = أكبر خفض خطر بأقل وقت. ٣–٥ تصلّب.

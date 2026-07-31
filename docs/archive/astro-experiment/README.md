# أرشيف: تجربة Astro (غير مستخدمة)

> **هذا الكود لا يُبنى ولا يُنشر ولا يخدم أي مستخدم.** محفوظ كمرجع فقط.
> تاريخ الأرشفة: 2026-07-31.

## ليش أُرشفت

المشروع كان فيه نظاما واجهة يستهدفان نفس مجلد `dist/`:
1. HTML ثابت (جذر المستودع) + `scripts/stage.mjs` — **هذا هو المستخدم فعلياً بالإنتاج**
2. Astro (`src/pages` + `src/components`) — كان يخدم صفر مستخدم

الاثنان **لا يمكن أن يعملا معاً**. السبب تقني وقاطع:

`astro build` مع محوّل Cloudflare ينتج `dist/_worker.js`. وجود `_worker.js` بمجلد المخرجات
يحوّل Cloudflare Pages إلى **Advanced Mode**، وفيه **يتجاهل مجلد `functions/` بالكامل**.

هذا حصل فعلياً بتاريخ 2026-07-31: تشغيل `astro build` أسقط **كل الـ ٥٦ endpoint**
إلى 404 على الإنتاج — بما فيها ويبهوك واتساب (البوت توقف) وتسجيل الدخول.

## ليش اخترنا HTML الثابت + `functions/`

- **كل القيمة التشغيلية في `functions/`:** تحقق تواقيع HMAC، عزل المتاجر (`resolveStoreId`)،
  الحصص، rate limit، وإصلاحات أمنية حرجة. نقلها لـ Astro = إعادة تدقيق أمني كامل ومخاطرة عالية.
- **Pages Functions هو النموذج الأصلي لـ Cloudflare Pages** — بلا محوّل وسيط يتكسر مع التحديثات.
- **الاستقرار أولوية:** التطبيق تحت مراجعة شريك سلة؛ أي عطل أثناءها يعني رفضاً.
- **لا فجوة وظيفية:** كل ما تقدمه مكونات Astro هنا موجود فعلاً بالصفحات الثابتة — مثلاً
  `BookingsTable.astro` يقابله جدول حجوزات كامل ومربوط بـ `/api/admin/bookings` في `admin.html`.
- إعادة استخدام المكونات متوفرة عبر `partials/` + `<!--#include -->`.

## الحماية الحالية

- `scripts/verify-dist.mjs` يرفض أي نشر يحتوي `_worker.js` أو `_routes.json` (يعمل داخل `npm run deploy`).
- سكربت `_astro:build` في `package.json` محجوب برسالة تشرح السبب.
- التفاصيل في `AGENT.md` القسم 4.

## متى نعيد النظر

لو تطلّب المنتج داشبورد معقداً فعلياً (رسوم تفاعلية، حالة مشتركة، مسارات كثيرة)، عندها
تُدرس هجرة كاملة ومقصودة: **نقل كل الـ endpoints إلى `src/pages/api/` دفعة واحدة**، مع
إعادة تنفيذ كل ضوابط الأمن وإعادة اختبارها. الحالة الوسطى (الاثنان معاً) غير ممكنة.

## المحتوى

```
astro.config.mjs
src/
  pages/       index · login · dashboard · admin · consultation
  components/  AgentPersonaStudio · BookingsTable · ChatSandbox · FlowBuilder
               KpiGrid · NavHeader · PlatformCards · SeoStudio · WebChatWidget
  layouts/     Layout.astro
```

# مشروع هالة — تعليمات إلزامية

## ⛔ اقرأ `AGENT.md` قبل أي تعديل

`AGENT.md` بجذر المستودع = دليل البنية الكامل (المعمارية، الأمن، البناء، الشخصية، الأسرار).
**اقرأه أولاً في أي جلسة تلمس فيها الكود.** الملخص الحرج أدناه، لكنه لا يغني عنه.

## 🚨 قواعد لا تُكسر

### البناء والنشر
- **انشر بـ `npm run deploy` فقط.** يبني ثم يفحص ثم ينشر على `--branch=main`.
- **لا تُدخل Astro أو أي أداة تنتج `dist/_worker.js`.** وجوده يحوّل Cloudflare Pages إلى
  Advanced Mode فيتجاهل مجلد `functions/` بالكامل — أسقط كل الـ ٥٦ endpoint إلى 404 على
  الإنتاج فعلاً (2026-07-31)، بما فيها ويبهوك واتساب وتسجيل الدخول.
  `scripts/verify-dist.mjs` يمنع ذلك آلياً؛ لا تُعطّله.
- النشر بلا `--branch=main` يذهب لفرع Preview ولا يراه أحد على الدومين الحي.
- **تحقق بعد كل نشر:**
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" https://hala-ai-os.pages.dev/api/health          # 200
  curl -s -o /dev/null -w "%{http_code}\n" -X POST \
    https://hala-ai-os.pages.dev/api/whatsapp/webhook -d '{}'                               # 401
  ```
  404 على أي منهما = الـ API ساقط.

### الأمن
- **لا أسرار مكتوبة بالكود، ولا قيم افتراضية للأسرار.** غياب السر = ارمِ خطأ (fail closed)،
  لا "تمرير برشاقة". ثلاث ثغرات مصادقة حرجة نشأت من كسر هذه القاعدة وأُغلقت (commit `47f569b`).
- **لا باب خلفي، لا كلمة مرور بالكود، لا تجاوز مصادقة بأي علم بيئة.**
- لا تثق بهوية يرسلها العميل (إيميل/معرّف) — تحقق منها من مصدرها.
- تواقيع الـ webhooks و `state` بتدفقات OAuth إلزامية — لا تُضعفها.

### الصدق
لا بيانات مفبركة تُعرض كأنها حقيقية: لا أسعار مخترعة، لا طلبات/عملاء وهميين، لا ادعاء
"نشط" لنظام غير مضبوط، لا ادعاء امتثال قانوني. ينطبق على الكود التجريبي أيضاً.

### الشخصية
مصدر واحد: `functions/_lib/ai/persona.js`. عدّل معه النسخة المرجعية في `persona/`.
البوت **ممنوع** يذكر أي رقم سعر — يوجّه للاستشارة المجانية.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

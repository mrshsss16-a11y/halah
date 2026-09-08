> ⚠️ **متجاوَز (2026-09-08)** — الحالات هنا تاريخية ولا تُعتمد. المرجع الحالي للتنفيذ: [`COMPLETION_PATH.md`](../../COMPLETION_PATH.md).

# أزرار حجز تفاعلية + تصعيد تلقائي — خطة التنفيذ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** استبدال حجز الاستشارة النصي الهش بقائمة WhatsApp تفاعلية حقيقية (ضغط مضمون بدل تخمين نصي)، وإضافة تصعيد تلقائي للإنسان لما يعجز البوت أو الطلب معقد — مع شبكة أمان بالكود لو الموديل ما قرر التصعيد بنفسه.

**Architecture:** كل التغيير محصور بـ`functions/api/whatsapp/webhook.js` وملفاته المساعدة (`_lib/whatsapp.js`, `_lib/persona.js`, `_lib/db.js`) — صفر لمسة على `chat.js`/`copy.js`/تدفقات التاجر. قائمة الحجز رسالة WhatsApp Interactive List رسمية (نوع `list`)، الرد عليها webhook بنوع `interactive`/`list_reply` — الكود يتعامل معه مباشرة بدون المرور بالموديل. التصعيد يعيد استخدام آلية سكوت البوت الموجودة (`getLastHumanReplyAt`) بمصدر جديد `source='escalated'`.

**Tech Stack:** نفس المشروع — Cloudflare Pages Functions، D1، WhatsApp Cloud API v21 (Graph API).

## Global Constraints

- محصور بـ`merchantId === "hala"` (رقم أورا) — صفر تغيير على مسار التاجر (`PERSONA_SYSTEM_PROMPT`).
- المسار النصي القديم للحجز (`[BOOK_SLOT:<label>]` بالنص الحر) يبقى شغال كـfallback — إضافة، مو استبدال.
- نص رسالة التصعيد ثابت بالكود (مو من الموديل) لضمان الاتساق: `"حولت طلبك لفريقنا، بيردون عليك قريب 🙌"`.
- شبكة الأمان: ٣ رسائل واردة متتالية خلال ٦٠ دقيقة بدون تصعيد بينها → تصعيد إجباري بالكود بغض النظر عن قرار الموديل.
- لا اختبار وحدات آلي بهذا المشروع — التحقق عبر `node --check` + فحص حي بعد النشر، نفس نمط كل المهام السابقة بهذا المستودع.
- كل commit: رسالة تشرح "ليش" مو "وش".

---

## خريطة الملفات

| الملف | الحالة | المسؤولية |
|---|---|---|
| `functions/_lib/whatsapp.js` | تعديل | `sendWaInteractiveList()` جديدة + `parseInbound()` يدعم `interactive`/`list_reply` |
| `functions/_lib/persona.js` | تعديل | `BOOKING_INSTRUCTIONS` تتحدث لماركر `[OFFER_SLOTS]`، `ESCALATION_INSTRUCTIONS` جديد |
| `functions/_lib/db.js` | تعديل | `getLastHumanReplyAt` يتحقق `source IN ('human','escalated')`، `countRecentInboundWithoutResolution()` جديدة |
| `functions/api/whatsapp/webhook.js` | تعديل | معالجة `list_reply` مباشرة، إرسال القائمة عند `[OFFER_SLOTS]`، كشف `[ESCALATE]` + شبكة الأمان |

---

### Task 1: `whatsapp.js` — إرسال واستقبال الرسائل التفاعلية

**Files:**
- Modify: `functions/_lib/whatsapp.js`

**Interfaces:**
- Consumes: `waConfigured(env)`, `GRAPH` (ثابت بالملف أصلاً)، `env.WHATSAPP_PHONE_ID`/`env.WHATSAPP_TOKEN`.
- Produces (تستخدمها Task 4):
  - `sendWaInteractiveList(env, {to, bodyText, buttonText, rows}): Promise<string>` (يرجع message id)
  - `parseInbound(payload)` يرجع كل عنصر بحقلين إضافيين: `listReplyId: string|null`, `listReplyTitle: string|null`

- [ ] **Step 1: أضف `sendWaInteractiveList` بعد `sendWaTemplate` مباشرة**

```js
/** Sends an interactive list message — up to 10 tap-to-choose rows in one section. */
export async function sendWaInteractiveList(env, { to, bodyText, buttonText, rows }) {
  if (!waConfigured(env)) throw new Error("WhatsApp غير مفعّل — أضف WHATSAPP_TOKEN و WHATSAPP_PHONE_ID.");
  const res = await fetch(`${GRAPH}/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: bodyText },
        action: {
          button: buttonText,
          sections: [{ title: "الفتحات المتاحة", rows }]
        }
      }
    })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`whatsapp interactive list failed: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.messages && data.messages[0] && data.messages[0].id;
}
```

- [ ] **Step 2: عدّل `parseInbound` ليستخرج رد القائمة التفاعلية**

استبدل الدالة كاملة بـ:

```js
/** Extract inbound messages from a webhook payload into a simple shape. */
export function parseInbound(payload) {
  const out = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const contacts = value.contacts || [];
      for (const msg of value.messages || []) {
        const contact = contacts.find((c) => c.wa_id === msg.from);
        const listReply =
          msg.type === "interactive" && msg.interactive && msg.interactive.type === "list_reply"
            ? msg.interactive.list_reply
            : null;
        out.push({
          from: msg.from,
          name: contact && contact.profile && contact.profile.name,
          text: msg.text && msg.text.body,
          type: msg.type,
          id: msg.id,
          listReplyId: listReply ? listReply.id : null,
          listReplyTitle: listReply ? listReply.title : null
        });
      }
    }
  }
  return out;
}
```

- [ ] **Step 3: تحقق من الصياغة**

Run: `node --check functions/_lib/whatsapp.js`
Expected: بدون مخرجات.

- [ ] **Step 4: Commit**

```bash
git add functions/_lib/whatsapp.js
git commit -m "feat(whatsapp): sendWaInteractiveList + parseInbound list_reply support"
```

---

### Task 2: `persona.js` — ماركرات القائمة التفاعلية والتصعيد

**Files:**
- Modify: `functions/_lib/persona.js`

**Interfaces:**
- Consumes: `WEEKLY_SLOTS` (موجودة أصلاً بالملف).
- Produces (تستخدمها Task 4): `BOOKING_INSTRUCTIONS` (نص معدّل)، `ESCALATION_INSTRUCTIONS` (تصدير جديد).

- [ ] **Step 1: استبدل `BOOKING_INSTRUCTIONS` بالكامل**

ابحث عن السطر اللي يبدأ بـ`export const BOOKING_INSTRUCTIONS` واستبدل كامل التعريف بـ:

```js
export const BOOKING_INSTRUCTIONS = `## حجز استشارة مجانية
لو الزائر وافق يحجز استشارة مجانية، اكتبي جملة قصيرة تعرض عليه اختيار وقت، وأنهي ردك بسطر منفصل بالضبط: [OFFER_SLOTS]
النظام يرسل له قائمة الفتحات كأزرار ضغط تلقائياً — لا تكتبين أسماء الفتحات بنفسك ولا تخترعين ماركر ثاني.
لو العميل كتب فتحة نصاً بدل ما يضغط زر (مثلاً "الأحد الساعة عشرة")، طابقيها مع إحدى هذي الفتحات:
${WEEKLY_SLOTS.join("، ")}
وأنهي ردك بسطر منفصل بالضبط: [BOOK_SLOT:<الفتحة كما هي بالقائمة أعلاه، حرفياً>]`;
```

- [ ] **Step 2: أضف `ESCALATION_INSTRUCTIONS` بعد `BOOKING_INSTRUCTIONS` مباشرة**

```js
export const ESCALATION_INSTRUCTIONS = `## تحويل لفريق بشري
لو حسيتِ إنك ما تقدرين تجاوبين على سؤال العميل (خارج نطاق معرفتك أعلاه ولا الـRAG يفيد)، أو كان الطلب معقد (شكوى، تفاوض سعر، تفصيل تقني عميق ما هو مذكور هنا) — لا تخمّنين ولا تخترعين جواب. أنهي ردك بسطر منفصل بالضبط: [ESCALATE]
ممكن تكتبين جملة قصيرة قبلها تعتذرين وتقولين بتحوّلينه لفريق مختص، بس السطر الأخير لازم يكون [ESCALATE] بالضبط.`;
```

- [ ] **Step 3: تحقق من الصياغة**

Run: `node --check functions/_lib/persona.js`
Expected: بدون مخرجات.

- [ ] **Step 4: Commit**

```bash
git add functions/_lib/persona.js
git commit -m "feat(persona): [OFFER_SLOTS] marker + ESCALATION_INSTRUCTIONS for Aura's WhatsApp"
```

---

### Task 3: `db.js` — استعلامات التصعيد والسكوت الموسّع

**Files:**
- Modify: `functions/_lib/db.js`

**Interfaces:**
- Consumes: `env.DB` (D1 binding، موجود أصلاً)، جدول `whatsapp_messages.source` (عمود موجود من migration 0008).
- Produces (تستخدمها Task 4):
  - `getLastHumanReplyAt(env, merchantId, phone): Promise<string|null>` (نفس التوقيع الموجود، منطق داخلي معدّل)
  - `countRecentInboundWithoutResolution(env, merchantId, phone, sinceMinutes=60): Promise<number>`

- [ ] **Step 1: عدّل `getLastHumanReplyAt` ليشمل `escalated` كمان**

ابحث عن الدالة الحالية:
```js
export async function getLastHumanReplyAt(env, merchantId, phone) {
  const row = await env.DB.prepare(
    "SELECT created_at FROM whatsapp_messages WHERE merchant_id = ? AND phone = ? AND direction = 'out' AND source = 'human' ORDER BY created_at DESC LIMIT 1"
  )
```
واستبدل السطر الثاني بس (شرط الـWHERE) بـ:
```js
export async function getLastHumanReplyAt(env, merchantId, phone) {
  const row = await env.DB.prepare(
    "SELECT created_at FROM whatsapp_messages WHERE merchant_id = ? AND phone = ? AND direction = 'out' AND source IN ('human', 'escalated') ORDER BY created_at DESC LIMIT 1"
  )
```
(باقي الدالة — `.bind(...)` و`return` — يبقى بدون تغيير.)

- [ ] **Step 2: أضف `countRecentInboundWithoutResolution` بعدها مباشرة**

```js
/**
 * Counts inbound messages from this phone in the last `sinceMinutes` that
 * arrived after the most recent escalation (or since the window start if
 * there was none). A code-level safety net: if the model never emits
 * [ESCALATE] but the customer keeps messaging unanswered, this forces
 * escalation regardless of what the model decided.
 */
export async function countRecentInboundWithoutResolution(env, merchantId, phone, sinceMinutes = 60) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM whatsapp_messages
     WHERE merchant_id = ? AND phone = ? AND direction = 'in'
       AND created_at > datetime('now', ?)
       AND created_at > COALESCE(
         (SELECT MAX(created_at) FROM whatsapp_messages
          WHERE merchant_id = ? AND phone = ? AND direction = 'out' AND source = 'escalated'),
         '1970-01-01'
       )`
  )
    .bind(merchantId || "hala", phone, `-${sinceMinutes} minutes`, merchantId || "hala", phone)
    .first();
  return row ? row.n : 0;
}
```

- [ ] **Step 3: تحقق من الصياغة**

Run: `node --check functions/_lib/db.js`
Expected: بدون مخرجات.

- [ ] **Step 4: Commit**

```bash
git add functions/_lib/db.js
git commit -m "feat(db): escalated-aware silence window + unresolved-message counter"
```

---

### Task 4: `webhook.js` — ربط كل شي + النشر والتحقق الحي

**Files:**
- Modify: `functions/api/whatsapp/webhook.js`

**Interfaces:**
- Consumes: كل شي من Task 1-3 (`sendWaInteractiveList`, `parseInbound` بحقولها الجديدة، `WEEKLY_SLOTS`, `ESCALATION_INSTRUCTIONS`, `getLastHumanReplyAt`, `countRecentInboundWithoutResolution`).

- [ ] **Step 1: عدّل الاستيرادات بأعلى الملف**

استبدل:
```js
import { verifyWaSignature, parseInbound, parseEchoes, sendWaText, waConfigured } from "../../_lib/whatsapp.js";
import { askWorkersAI } from "../../_lib/workersAI.js";
import { PERSONA_SYSTEM_PROMPT, HALA_SUPPORT_PROMPT, BOOKING_INSTRUCTIONS, dialectLabel } from "../../_lib/persona.js";
import { recordWaInbound, recordWaOutbound, recentWaHistory, getMarketingContext, saveConsultationBooking, getLastHumanReplyAt } from "../../_lib/db.js";
```
بـ:
```js
import { verifyWaSignature, parseInbound, parseEchoes, sendWaText, sendWaInteractiveList, waConfigured } from "../../_lib/whatsapp.js";
import { askWorkersAI } from "../../_lib/workersAI.js";
import { PERSONA_SYSTEM_PROMPT, HALA_SUPPORT_PROMPT, BOOKING_INSTRUCTIONS, ESCALATION_INSTRUCTIONS, WEEKLY_SLOTS, dialectLabel } from "../../_lib/persona.js";
import { recordWaInbound, recordWaOutbound, recentWaHistory, getMarketingContext, saveConsultationBooking, getLastHumanReplyAt, countRecentInboundWithoutResolution } from "../../_lib/db.js";
```

- [ ] **Step 2: عدّل الثوابت وحقن `ESCALATION_INSTRUCTIONS` بالبرومبت**

استبدل:
```js
const BOOK_SLOT_RE = /\[BOOK_SLOT:([^\]]+)\]/;
```
بـ:
```js
const BOOK_SLOT_RE = /\[BOOK_SLOT:([^\]]+)\]/;
const OFFER_SLOTS_RE = /\[OFFER_SLOTS\]/;
const ESCALATE_RE = /\[ESCALATE\]/;
const ESCALATION_MESSAGE = "حولت طلبك لفريقنا، بيردون عليك قريب 🙌";
const SAFETY_NET_THRESHOLD = 3;
const SAFETY_NET_WINDOW_MINUTES = 60;
```

بعدها بالـ`autoReply` — ابحث عن سطر:
```js
هذي محادثة واتساب حقيقية — ردي بإيجاز (سطر أو سطرين).

${BOOKING_INSTRUCTIONS}${ragContext}`;
```
واستبدله بـ:
```js
هذي محادثة واتساب حقيقية — ردي بإيجاز (سطر أو سطرين).

${BOOKING_INSTRUCTIONS}

${ESCALATION_INSTRUCTIONS}${ragContext}`;
```

- [ ] **Step 3: استبدل دالة `autoReply` بالكامل**

```js
async function autoReply(env, merchantId, phone, incomingText, contactName) {
  const lastHumanReplyAt = env.DB ? await getLastHumanReplyAt(env, merchantId, phone).catch(() => null) : null;
  if (lastHumanReplyAt && Date.now() - new Date(`${lastHumanReplyAt}Z`).getTime() < HUMAN_SILENCE_WINDOW_MS) {
    return null;
  }

  if (env.DB && merchantId === "hala") {
    const unresolvedCount = await countRecentInboundWithoutResolution(
      env,
      merchantId,
      phone,
      SAFETY_NET_WINDOW_MINUTES
    ).catch(() => 0);
    if (unresolvedCount >= SAFETY_NET_THRESHOLD) {
      return { text: ESCALATION_MESSAGE, offerSlots: false, escalate: true };
    }
  }

  const history = env.DB ? await recentWaHistory(env, merchantId, phone).catch(() => []) : [];
  const memories = await recallSimilar({ env, storeId: merchantId, question: incomingText }).catch(() => []);
  const ragContext = memories.length
    ? `\n\n## معرفة ذات صلة (استخدميها لو تساعد بالإجابة، تجاهليها لو مو مرتبطة)\n${memories
        .map((m) => `- س: ${m.question}\n  ج: ${m.reply}`)
        .join("\n")}`
    : "";

  let system;
  if (merchantId === "hala") {
    system = `${HALA_SUPPORT_PROMPT}

---

هذي محادثة واتساب حقيقية — ردي بإيجاز (سطر أو سطرين).

${BOOKING_INSTRUCTIONS}

${ESCALATION_INSTRUCTIONS}${ragContext}`;
  } else {
    const ctx = env.DB ? await getMarketingContext(env, merchantId).catch(() => null) : null;
    const dialect = (ctx && ctx.dialect) || "saudi_najdi";
    const instructions = (ctx && ctx.instructions) || "لا توجد تعليمات إضافية.";
    system = `${PERSONA_SYSTEM_PROMPT}

---

## سياق واتساب
اللهجة: ${dialectLabel(dialect)} (${dialect})
تعليمات المتجر: ${instructions}
هذي محادثة واتساب حقيقية مع عميل — ردي بإيجاز (سطر أو سطرين)، مباشرة، بدون طلب بيانات دفع.${ragContext}`;
  }

  const turns = history
    .map((m) => ({ role: m.direction === "in" ? "user" : "assistant", content: m.body }))
    .concat([{ role: "user", content: incomingText }])
    .slice(-8);

  let reply = await askWorkersAI({ env, system, messages: turns, maxTokens: 300 });

  if (merchantId === "hala" && ESCALATE_RE.test(reply)) {
    return { text: ESCALATION_MESSAGE, offerSlots: false, escalate: true };
  }

  let offerSlots = false;
  if (merchantId === "hala" && OFFER_SLOTS_RE.test(reply)) {
    offerSlots = true;
    reply = reply.replace(OFFER_SLOTS_RE, "").trim();
  }

  const bookMatch = reply.match(BOOK_SLOT_RE);
  if (bookMatch && merchantId === "hala") {
    const slotLabel = bookMatch[1].trim();
    await saveConsultationBooking(env, { name: contactName || null, phone, slotLabel }).catch(() => {});
    reply = reply.replace(BOOK_SLOT_RE, "").trim();
  }

  return { text: reply, offerSlots, escalate: false };
}
```

- [ ] **Step 4: استبدل حلقة معالجة `inbound` بالكامل بـ`onRequestPost`**

ابحث عن الحلقة:
```js
      for (const msg of inbound) {
        if (!msg.text) continue;
        try {
          await recordWaInbound(env, {
            merchantId,
            phone: msg.from,
            name: msg.name,
            body: msg.text,
            waMessageId: msg.id
          });
          if (waConfigured(env)) {
            const reply = await autoReply(env, merchantId, msg.from, msg.text, msg.name);
            if (reply) {
              const outId = await sendWaText(env, { to: msg.from, body: reply });
              await recordWaOutbound(env, { merchantId, phone: msg.from, body: reply, waMessageId: outId, source: "bot" });
            }
          }
        } catch (err) {
          console.error("[wa-webhook]", err);
        }
      }
```
واستبدلها بالكامل بـ:
```js
      for (const msg of inbound) {
        try {
          // Customer tapped a list row — deterministic booking, no model round-trip.
          if (msg.listReplyId != null && merchantId === "hala") {
            const idx = Number(msg.listReplyId);
            const slotLabel = Number.isInteger(idx) ? WEEKLY_SLOTS[idx] : null;
            if (slotLabel) {
              await recordWaInbound(env, {
                merchantId,
                phone: msg.from,
                name: msg.name,
                body: `[ضغط: ${slotLabel}]`,
                waMessageId: msg.id
              });
              await saveConsultationBooking(env, { name: msg.name || null, phone: msg.from, slotLabel }).catch(() => {});
              const confirmText = `تم حجز استشارتك ${slotLabel} ✅ فريقنا بيتواصل معك بالوقت المحدد.`;
              const outId = await sendWaText(env, { to: msg.from, body: confirmText });
              await recordWaOutbound(env, { merchantId, phone: msg.from, body: confirmText, waMessageId: outId, source: "bot" });
            }
            continue;
          }

          if (!msg.text) continue;

          await recordWaInbound(env, {
            merchantId,
            phone: msg.from,
            name: msg.name,
            body: msg.text,
            waMessageId: msg.id
          });

          if (waConfigured(env)) {
            const result = await autoReply(env, merchantId, msg.from, msg.text, msg.name);
            if (!result) continue;

            if (result.text) {
              const outId = await sendWaText(env, { to: msg.from, body: result.text });
              await recordWaOutbound(env, {
                merchantId,
                phone: msg.from,
                body: result.text,
                waMessageId: outId,
                source: result.escalate ? "escalated" : "bot"
              });
            }

            if (result.offerSlots) {
              const rows = WEEKLY_SLOTS.map((label, i) => ({ id: String(i), title: label }));
              const listId = await sendWaInteractiveList(env, {
                to: msg.from,
                bodyText: "اختر الوقت المناسب لك:",
                buttonText: "اختيار وقت",
                rows
              });
              await recordWaOutbound(env, {
                merchantId,
                phone: msg.from,
                body: "[قائمة فتحات الاستشارة]",
                waMessageId: listId,
                source: "bot"
              });
            }
          }
        } catch (err) {
          console.error("[wa-webhook]", err);
        }
      }
```

- [ ] **Step 5: تحقق من الصياغة**

Run: `node --check functions/api/whatsapp/webhook.js`
Expected: بدون مخرجات.

- [ ] **Step 6: `npm run stage` كامل**

Run: `node scripts/stage.mjs`
Expected: `staged N files into dist/` بدون تحذيرات.

- [ ] **Step 7: نشر**

```bash
npx wrangler pages deploy dist --project-name hala-ai-os --branch=main
```

- [ ] **Step 8: فحص حي — قائمة الحجز التفاعلية**

راسل رقم أورا الاختباري بسؤال يقود لعرض الحجز (مثلاً "أبي أحجز استشارة"). تحقق:
- توصل رسالة List Message حقيقية (أزرار ضغط، مو نص خيارات).
- الضغط على فتحة → رد تأكيد فوري، وتحقق التسجيل:
```bash
npx wrangler d1 execute halah-tr-db --remote --command "SELECT * FROM consultation_bookings ORDER BY id DESC LIMIT 1"
```
Expected: صف جديد بالفتحة المختارة.

- [ ] **Step 9: فحص حي — شبكة أمان التصعيد**

راسل ٣ رسائل متتالية بسؤال غامض/خارج النطاق من نفس الرقم بأقل من ٦٠ دقيقة. تحقق الرسالة الثالثة ترجع نص التصعيد الثابت، وتحقق التسجيل:
```bash
npx wrangler d1 execute halah-tr-db --remote --command "SELECT direction, source, body FROM whatsapp_messages WHERE source='escalated' ORDER BY created_at DESC LIMIT 1"
```
Expected: صف بـ`source='escalated'` وبالنص الثابت.

- [ ] **Step 10: Commit**

```bash
git add functions/api/whatsapp/webhook.js
git commit -m "feat(whatsapp): wire interactive booking + auto-escalation into the webhook"
```

---

## مراجعة ذاتية (Self-Review)

- **تغطية المواصفة:** قائمة تفاعلية (Task 1+4)، تصعيد بقرار الموديل (Task 2+4)، شبكة أمان بالكود (Task 3+4)، إعادة استخدام آلية السكوت (Task 3 Step 1) — كل بند بالمواصفة له مهمة مطابقة.
- **فحص Placeholders:** لا `TBD`/`TODO` — كل خطوة كود فيها الكود الكامل.
- **اتساق الأنواع:** `autoReply` يرجع الآن `{text, offerSlots, escalate} | null` بدل `string | null` — التغيير موثّق بالكامل بـTask 4 Step 3+4 معاً (نفس المهمة تعرّف وتستهلك التوقيع الجديد، ما يصير تعارض بين مهام). `sendWaInteractiveList` يرجع `string` (message id) بنفس نمط `sendWaText`/`sendWaTemplate` الموجودة.

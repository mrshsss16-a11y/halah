# WhatsApp أورا + لوحة أدمن — خطة التنفيذ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** تصحيح شخصية webhook واتساب أورا، إضافة RAG حقيقي من `hala_faq`، حجز استشارة مجانية عبر واتساب، ولوحة `admin.html` محمية بإيميل مسموح فقط (بدون role عمود، بدون console SQL).

**Architecture:** Cloudflare Pages Functions (Workers) + D1 (migration 0006) + Vectorize (يعاد استخدام `memory.js` الموجود بـ`storeId="hala"`) + جلسة موقّعة موجودة (`session.js`) موسّعة بدالة `requireAdmin`. لا أطر عمل جديدة — HTML ساكن بنفس نظام `partials/`.

**Tech Stack:** نفس المشروع الحالي بالضبط — Vanilla JS (Pages Functions)، D1 SQL خام، Tailwind CDN، بدون npm packages جديدة.

## Global Constraints

- لا اختبار وحدات آلي بهذا المشروع (لا jest/vitest بـ`package.json`) — التحقق عبر `node --check <file>` لكل ملف JS + سكربت فحص محلي بـNode لمنطق نقي (بدون Workers bindings) + فحص حي (`npm run stage` ثم `wrangler pages deploy` ثم curl/متصفح) — هذا هو نمط التحقق المستخدم بكل المشروع، اتبعه حرفياً.
- كل commit: رسالة تشرح "ليش" مو "وش"، بدون `--no-verify`.
- كل ميجريشن D1 جديدة تبدأ رقمها من `0006` (0003 مفقودة، لا تستخدمها).
- ممنوع أي عمود `role` بجدول `accounts` — الأدمن يتحدد فقط بمطابقة `accounts.email` مع سر `ADMIN_EMAILS`.
- ممنوع أي مسار يسمح بتنفيذ SQL خام من الواجهة.
- الأسرار الأربعة لواتساب (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`) و`ADMIN_EMAILS` تُضبط فقط عبر `wrangler pages secret put` — لا قيمة افتراضية بالكود.
- كل استجابة API تتبع نمط الملف الحالي: `withApi(handler)` من `functions/_lib/respond.js`، ترجع كائن عادي (`{ok, ...}` أو `{error, code}`) — status 200 حتى لأخطاء منطقية، نفس نمط `copy.js`/`chat.js` الموجود. لا تخترع نمط استجابة جديد.

---

## خريطة الملفات

| الملف | الحالة | المسؤولية |
|---|---|---|
| `migrations/0006_hala_admin.sql` | جديد | `accounts.disabled` + `hala_faq` + `consultation_bookings` + بذر FAQ أولي |
| `functions/_lib/db.js` | تعديل | دوال جديدة: hala_faq CRUD، bookings CRUD، `recentWaConversations`، `getAccountEmail`، `listAccounts`، `setAccountDisabled`، `adminStats` |
| `functions/_lib/memory.js` | تعديل | `reembedHalaFaq(env, rows)` |
| `functions/_lib/session.js` | تعديل | `requireAdmin(request, env)` |
| `functions/_lib/persona.js` | تعديل | إضافة `WEEKLY_SLOTS` (نص فتحات الاستشارة) + سطر توجيه حجز بـ`HALA_SUPPORT_PROMPT` |
| `functions/api/whatsapp/webhook.js` | تعديل | تصحيح اختيار الشخصية + حقن RAG + استخراج `[BOOK_SLOT:]` |
| `functions/api/support.js` | تعديل | حقن RAG قبل توليد الرد |
| `functions/api/auth/login.js` | تعديل | رفض تسجيل الدخول لو `disabled=1` |
| `functions/api/admin/faq.js` | جديد | CRUD معرفة هالة |
| `functions/api/admin/bookings.js` | جديد | عرض/تحديث حالة الحجوزات |
| `functions/api/admin/conversations.js` | جديد | آخر محادثات واتساب أورا |
| `functions/api/admin/accounts.js` | جديد | عرض/تعطيل حسابات |
| `functions/api/admin/overview.js` | جديد | عدادات لوحة القيادة |
| `admin.html` | جديد | صفحة اللوحة (تستخدم `partials/fouc-theme.html`) |
| `README.md` | تعديل | إضافة `ADMIN_EMAILS` لجدول الأسرار |

---

### Task 1: ميجريشن D1 — الجداول الجديدة + بذر المعرفة

**Files:**
- Create: `migrations/0006_hala_admin.sql`

**Interfaces:**
- Produces: جدول `hala_faq(id, question, answer, created_at, updated_at)`، جدول `consultation_bookings(id, name, phone, preferred_slot_label, status, created_at)`، عمود `accounts.disabled`.

- [ ] **Step 1: اكتب ملف الميجريشن**

```sql
-- migrations/0006_hala_admin.sql
-- Admin layer: disable flag on accounts, Hala's own FAQ knowledge (RAG source
-- of truth), and free-consultation bookings from the Aura WhatsApp line.

ALTER TABLE accounts ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS hala_faq (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS consultation_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  phone TEXT NOT NULL,
  preferred_slot_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_consultation_bookings_status ON consultation_bookings (status, created_at);

-- Seed from persona/hala-support-knowledge.md — keep both in sync by hand.
INSERT INTO hala_faq (question, answer) VALUES
  ('وش تسوي هالة بالضبط؟', 'هالة ذكاء اصطناعي سعودي يخدم أصحاب المتاجر الإلكترونية: يفحص المتجر مجاناً ويكتشف خسائره خلال ٣٠ ثانية، يكتب أوصاف منتجات احترافية بلهجة سعودية، يحسّن صور المنتجات، ويرد على عملاء المتجر تلقائياً ويسترد السلات المتروكة عبر واتساب.'),
  ('كم سعر هالة؟', 'تجربة مجانية ٣٠ يوم: ٢٠٠ وصف منتج + ٤٠٠ صورة استوديو + ٥٠ رسالة واتساب، بدون بطاقة ائتمان. ما فيه سعر شهري منشور بعد التجربة — فريقنا يحدده حسب حجم متجرك مباشرة على واتساب.'),
  ('كيف أبدأ مع هالة؟', 'تقدر تبدأ بفحص متجرك المجاني خلال ٣٠ ثانية من الصفحة الرئيسية، أو تتواصل معنا مباشرة على واتساب ونساعدك خطوة بخطوة.'),
  ('هالة يشتغل مع أي منصات؟', 'هالة يتكامل مع سلة و Trendyol حالياً، ودعم منصة زد قادم قريباً.'),
  ('هل أحتاج بطاقة ائتمان للتجربة؟', 'لا، التجربة المجانية ٣٠ يوم بدون بطاقة ائتمان إطلاقاً. الفحص الأولي للمتجر مجاني دائماً حتى بعد انتهاء التجربة.'),
  ('هل أقدر أحجز استشارة مجانية؟', 'أكيد، أقدر أحدد لك موعد استشارة مجانية مع فريق هالة — قولي الوقت المناسب لك وأرتبه.');
```

- [ ] **Step 2: طبّق الميجريشن محلياً للتحقق من الصياغة**

Run: `npx wrangler d1 migrations apply halah-tr-db --local`
Expected: `Migrations to be applied: 0006_hala_admin.sql` ثم `✅ ... Executed N queries`, بدون أخطاء SQL.

- [ ] **Step 3: تحقق من الجداول محلياً**

Run: `npx wrangler d1 execute halah-tr-db --local --command "SELECT question FROM hala_faq"`
Expected: 6 صفوف ترجع بدون خطأ.

- [ ] **Step 4: Commit**

```bash
git add migrations/0006_hala_admin.sql
git commit -m "feat(db): migration 0006 — accounts.disabled + hala_faq + consultation_bookings"
```

---

### Task 2: `db.js` — دوال المعرفة والحجوزات والحسابات

**Files:**
- Modify: `functions/_lib/db.js` (إضافة بنهاية الملف)

**Interfaces:**
- Consumes: `env.DB` (D1 binding، موجود أصلاً).
- Produces (تستخدمها المهام اللاحقة):
  - `listHalaFaq(env): Promise<{id, question, answer}[]>`
  - `saveHalaFaqEntry(env, {id?, question, answer}): Promise<number>` (يرجع الـid)
  - `deleteHalaFaqEntry(env, id): Promise<void>`
  - `getAccountEmail(env, merchantId): Promise<string|null>`
  - `listAccounts(env, limit=200): Promise<{merchantId, email, createdAt, disabled}[]>`
  - `setAccountDisabled(env, merchantId, disabled: boolean): Promise<void>`
  - `isAccountDisabled(env, merchantId): Promise<boolean>`
  - `recentWaConversations(env, merchantId, limit=50): Promise<{phone, lastBody, lastDirection, lastAt}[]>`
  - `saveConsultationBooking(env, {name, phone, slotLabel}): Promise<number>`
  - `listConsultationBookings(env, limit=100): Promise<{id, name, phone, preferredSlotLabel, status, createdAt}[]>`
  - `setBookingStatus(env, id, status: 'pending'|'confirmed'|'cancelled'): Promise<void>`
  - `adminStats(env): Promise<{merchants, accounts, bookings, faqEntries}>`

- [ ] **Step 1: أضف دوال hala_faq**

```js
// ── Hala's own FAQ knowledge (RAG source of truth for the support persona) ──

export async function listHalaFaq(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, question, answer FROM hala_faq ORDER BY id"
  ).all();
  return results || [];
}

export async function saveHalaFaqEntry(env, { id, question, answer }) {
  if (id) {
    await env.DB.prepare(
      "UPDATE hala_faq SET question = ?, answer = ?, updated_at = datetime('now') WHERE id = ?"
    )
      .bind(question, answer, id)
      .run();
    return id;
  }
  const res = await env.DB.prepare(
    "INSERT INTO hala_faq (question, answer) VALUES (?, ?)"
  )
    .bind(question, answer)
    .run();
  return res.meta.last_row_id;
}

export async function deleteHalaFaqEntry(env, id) {
  await env.DB.prepare("DELETE FROM hala_faq WHERE id = ?").bind(id).run();
}
```

- [ ] **Step 2: أضف دوال الحسابات (إيميل، قائمة، تعطيل)**

```js
// ── Accounts admin helpers ──

export async function getAccountEmail(env, merchantId) {
  const row = await env.DB.prepare("SELECT email FROM accounts WHERE merchant_id = ?")
    .bind(merchantId)
    .first();
  return row ? row.email : null;
}

export async function listAccounts(env, limit = 200) {
  const { results } = await env.DB.prepare(
    "SELECT merchant_id, email, created_at, disabled FROM accounts ORDER BY created_at DESC LIMIT ?"
  )
    .bind(limit)
    .all();
  return (results || []).map((r) => ({
    merchantId: r.merchant_id,
    email: r.email,
    createdAt: r.created_at,
    disabled: Boolean(r.disabled)
  }));
}

export async function setAccountDisabled(env, merchantId, disabled) {
  await env.DB.prepare("UPDATE accounts SET disabled = ? WHERE merchant_id = ?")
    .bind(disabled ? 1 : 0, merchantId)
    .run();
}

export async function isAccountDisabled(env, merchantId) {
  const row = await env.DB.prepare("SELECT disabled FROM accounts WHERE merchant_id = ?")
    .bind(merchantId)
    .first();
  return Boolean(row && row.disabled);
}
```

- [ ] **Step 3: أضف `recentWaConversations` (آخر رسالة لكل جوال فريد)**

```js
// ── WhatsApp admin overview ──

export async function recentWaConversations(env, merchantId, limit = 50) {
  const { results } = await env.DB.prepare(
    `SELECT phone, body, direction, created_at
     FROM whatsapp_messages
     WHERE merchant_id = ?
       AND id IN (
         SELECT MAX(id) FROM whatsapp_messages WHERE merchant_id = ? GROUP BY phone
       )
     ORDER BY created_at DESC
     LIMIT ?`
  )
    .bind(merchantId || "hala", merchantId || "hala", limit)
    .all();
  return (results || []).map((r) => ({
    phone: r.phone,
    lastBody: r.body,
    lastDirection: r.direction,
    lastAt: r.created_at
  }));
}
```

- [ ] **Step 4: أضف دوال الحجوزات**

```js
// ── Consultation bookings ──

export async function saveConsultationBooking(env, { name, phone, slotLabel }) {
  const res = await env.DB.prepare(
    "INSERT INTO consultation_bookings (name, phone, preferred_slot_label) VALUES (?, ?, ?)"
  )
    .bind(name || null, phone, slotLabel)
    .run();
  return res.meta.last_row_id;
}

export async function listConsultationBookings(env, limit = 100) {
  const { results } = await env.DB.prepare(
    "SELECT id, name, phone, preferred_slot_label, status, created_at FROM consultation_bookings ORDER BY created_at DESC LIMIT ?"
  )
    .bind(limit)
    .all();
  return (results || []).map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    preferredSlotLabel: r.preferred_slot_label,
    status: r.status,
    createdAt: r.created_at
  }));
}

export async function setBookingStatus(env, id, status) {
  await env.DB.prepare("UPDATE consultation_bookings SET status = ? WHERE id = ?")
    .bind(status, id)
    .run();
}
```

- [ ] **Step 5: أضف `adminStats`**

```js
// ── Admin dashboard counters (read-only, no raw SQL exposed to the client) ──

export async function adminStats(env) {
  const [merchants, accounts, bookings, faqEntries] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM merchants").first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM consultation_bookings").first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM hala_faq").first()
  ]);
  return {
    merchants: merchants.n,
    accounts: accounts.n,
    bookings: bookings.n,
    faqEntries: faqEntries.n
  };
}
```

- [ ] **Step 6: تحقق من الصياغة**

Run: `node --check functions/_lib/db.js`
Expected: بدون مخرجات (نجاح صامت).

- [ ] **Step 7: Commit**

```bash
git add functions/_lib/db.js
git commit -m "feat(db): hala_faq/bookings/accounts-admin/recentWaConversations helpers"
```

---

### Task 3: `memory.js` — إعادة تضمين معرفة هالة بـVectorize

**Files:**
- Modify: `functions/_lib/memory.js`

**Interfaces:**
- Consumes: `embedText({env, text})` (موجودة بـ`workersAI.js`)، `listHalaFaq(env)` من Task 2.
- Produces: `reembedHalaFaq(env): Promise<number>` (يرجع عدد الصفوف المُضمّنة).

- [ ] **Step 1: أضف الدالة بنهاية `memory.js`**

معرّفات ثابتة (`hala_faq_${id}`) بدل عشوائية — بهذا الشكل `upsert` يستبدل نفس السجل عند إعادة التضمين بدل ما يكرره، فما نحتاج نمسح القديم يدوياً.

```js
/**
 * Re-embeds every row in D1's hala_faq table into Vectorize under
 * storeId="hala", so the WhatsApp/support personas can recallSimilar()
 * against it exactly like a merchant's memory. Deterministic ids
 * (hala_faq_<row id>) mean a re-run overwrites in place — no separate
 * delete pass needed.
 */
export async function reembedHalaFaq(env, faqRows) {
  if (!env.VECTORIZE_INDEX) return 0;
  let count = 0;
  for (const row of faqRows) {
    const values = await embedText({ env, text: row.question });
    await env.VECTORIZE_INDEX.upsert([
      {
        id: `hala_faq_${row.id}`,
        values,
        metadata: {
          question: row.question,
          reply: row.answer,
          score: 10,
          dialect: "saudi_najdi",
          storeId: "hala",
          ts: Date.now()
        }
      }
    ]);
    count++;
  }
  return count;
}
```

- [ ] **Step 2: تحقق من الصياغة**

Run: `node --check functions/_lib/memory.js`
Expected: بدون مخرجات.

- [ ] **Step 3: Commit**

```bash
git add functions/_lib/memory.js
git commit -m "feat(memory): reembedHalaFaq — push D1 hala_faq rows into Vectorize storeId=hala"
```

---

### Task 4: `session.js` — `requireAdmin`

**Files:**
- Modify: `functions/_lib/session.js`

**Interfaces:**
- Consumes: `getSessionMerchantId(request, env)` (موجودة بنفس الملف)، `getAccountEmail(env, merchantId)` من Task 2 (استيراد جديد من `./db.js`).
- Produces: `requireAdmin(request, env): Promise<{merchantId, email} | null>`

- [ ] **Step 1: أضف الاستيراد بأعلى الملف**

```js
import { getAccountEmail } from "./db.js";
```

- [ ] **Step 2: أضف الدالة قبل السطر الأخير (`export { COOKIE_NAME };`)**

```js
/**
 * Admin gate: session token only carries merchantId (see resolveStoreId
 * above), never email — so this looks up the account's email in D1 and
 * checks it against the ADMIN_EMAILS secret. No role column anywhere:
 * there is no code path that can grant admin by writing to the DB, only
 * by editing the Cloudflare secret.
 */
export async function requireAdmin(request, env) {
  const merchantId = await getSessionMerchantId(request, env);
  if (!merchantId) return null;
  const email = await getAccountEmail(env, merchantId);
  if (!email) return null;
  const allow = (env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!allow.includes(email.toLowerCase())) return null;
  return { merchantId, email };
}
```

- [ ] **Step 3: تحقق من الصياغة**

Run: `node --check functions/_lib/session.js`
Expected: بدون مخرجات.

- [ ] **Step 4: فحص منطقي محلي (بدون Workers bindings — محاكاة يدوية)**

هذا المشروع بدون إطار اختبار؛ نتحقق من منطق تحليل `ADMIN_EMAILS` بسكربت Node منفصل ومؤقت (لا يُحفظ بالمستودع):

```bash
node -e "
const allow = ' Owner@Aura.sa , team@aura.sa '.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
console.log(allow.includes('owner@aura.sa'));   // expect: true
console.log(allow.includes('random@x.com'));    // expect: false
"
```
Expected: `true` ثم `false`.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/session.js
git commit -m "feat(session): requireAdmin — ADMIN_EMAILS allowlist gate, no role column"
```

---

### Task 5: تصحيح شخصية الـwebhook + حقن RAG + الحجز

**Files:**
- Modify: `functions/api/whatsapp/webhook.js`
- Modify: `functions/_lib/persona.js` (إضافة `WEEKLY_SLOTS` + سطر توجيه بـ`HALA_SUPPORT_PROMPT`)

**Interfaces:**
- Consumes: `HALA_SUPPORT_PROMPT` (موجود)، `recallSimilar` من `memory.js` (موجود)، `saveConsultationBooking` من Task 2.
- Produces: لا شي جديد يُستهلك بمهام لاحقة — نهاية سلسلة الـwebhook.

- [ ] **Step 1: أضف فتحات الاستشابة الأسبوعية بـ`persona.js`**

بعد `HALA_SUPPORT_PROMPT` مباشرة (قبل `export const DIALECT_LABELS`):

```js
export const WEEKLY_SLOTS = [
  "الأحد ١٠ص", "الأحد ١٢م", "الاثنين ١٠ص", "الاثنين ١٢م",
  "الثلاثاء ١٠ص", "الثلاثاء ١٢م", "الأربعاء ١٠ص", "الأربعاء ١٢م",
  "الخميس ١٠ص", "الخميس ١٢م"
];

export const BOOKING_INSTRUCTIONS = `## حجز استشارة مجانية
لو الزائر وافق يحجز استشارة مجانية، اعرضي عليه فتحات من هذي القائمة (اذكري 3 فقط، الأقرب):
${WEEKLY_SLOTS.join("، ")}
لما يختار فتحة، أنهي ردك بسطر منفصل بالضبط: [BOOK_SLOT:<الفتحة كما كتبها>] — مثال: [BOOK_SLOT:الأحد ١٠ص]
لا تكتبين [BOOK_SLOT:] إلا بعد ما العميل يأكد فتحة محددة صراحة.`;
```

- [ ] **Step 2: عدّل استيرادات `webhook.js`**

```js
import { verifyWaSignature, parseInbound, sendWaText, waConfigured } from "../../_lib/whatsapp.js";
import { askWorkersAI } from "../../_lib/workersAI.js";
import { PERSONA_SYSTEM_PROMPT, HALA_SUPPORT_PROMPT, BOOKING_INSTRUCTIONS, dialectLabel } from "../../_lib/persona.js";
import { recordWaInbound, recordWaOutbound, recentWaHistory, getMarketingContext, saveConsultationBooking } from "../../_lib/db.js";
import { recallSimilar } from "../../_lib/memory.js";
```

- [ ] **Step 3: استبدل دالة `autoReply` بالكامل**

```js
const BOOK_SLOT_RE = /\[BOOK_SLOT:([^\]]+)\]/;

async function autoReply(env, merchantId, phone, incomingText, contactName) {
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

${BOOKING_INSTRUCTIONS}${ragContext}`;
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

  const bookMatch = reply.match(BOOK_SLOT_RE);
  if (bookMatch && merchantId === "hala") {
    const slotLabel = bookMatch[1].trim();
    await saveConsultationBooking(env, { name: contactName || null, phone, slotLabel }).catch(() => {});
    reply = reply.replace(BOOK_SLOT_RE, "").trim();
  }

  return reply;
}
```

- [ ] **Step 4: عدّل نداء `autoReply` بـ`onRequestPost` ليمرر اسم جهة الاتصال**

ابحث عن السطر:
```js
            const reply = await autoReply(env, merchantId, msg.from, msg.text);
```
واستبدله بـ:
```js
            const reply = await autoReply(env, merchantId, msg.from, msg.text, msg.name);
```

- [ ] **Step 5: تحقق من الصياغة**

Run: `node --check functions/_lib/persona.js && node --check functions/api/whatsapp/webhook.js`
Expected: بدون مخرجات.

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/persona.js functions/api/whatsapp/webhook.js
git commit -m "fix(whatsapp): correct persona for Aura's own number + RAG context + slot booking"
```

---

### Task 6: RAG بصفحة الدعم (`support.js`)

**Files:**
- Modify: `functions/api/support.js`

**Interfaces:**
- Consumes: `recallSimilar` من `memory.js` (نفس Task 5).

- [ ] **Step 1: أضف الاستيراد**

```js
import { recallSimilar } from "../_lib/memory.js";
```

- [ ] **Step 2: عدّل `supportHandler` ليحقن RAG قبل توليد الرد**

استبدل:
```js
  let reply = await askWorkersAI({
    env,
    system: HALA_SUPPORT_PROMPT,
    messages: turns,
    maxTokens: 400
  });
```
بـ:
```js
  const lastUserText = turns[turns.length - 1].content;
  const memories = await recallSimilar({ env, storeId: "hala", question: lastUserText }).catch(() => []);
  const ragContext = memories.length
    ? `\n\n## معرفة ذات صلة (استخدميها لو تساعد بالإجابة، تجاهليها لو مو مرتبطة)\n${memories
        .map((m) => `- س: ${m.question}\n  ج: ${m.reply}`)
        .join("\n")}`
    : "";

  let reply = await askWorkersAI({
    env,
    system: `${HALA_SUPPORT_PROMPT}${ragContext}`,
    messages: turns,
    maxTokens: 400
  });
```

- [ ] **Step 3: تحقق من الصياغة**

Run: `node --check functions/api/support.js`
Expected: بدون مخرجات.

- [ ] **Step 4: Commit**

```bash
git add functions/api/support.js
git commit -m "feat(support): inject hala_faq RAG context before generating a reply"
```

---

### Task 7: رفض تسجيل الدخول للحساب المعطّل

**Files:**
- Modify: `functions/api/auth/login.js`

**Interfaces:**
- Consumes: `isAccountDisabled` من Task 2.

- [ ] **Step 1: اقرأ الملف الحالي أولاً لتحديد نقطة الإدراج بالضبط**

هذي الخطوة قراءة فقط — افتح `functions/api/auth/login.js` وحدد السطر بعد التحقق من كلمة المرور مباشرة (قبل إنشاء `createSessionToken`).

- [ ] **Step 2: أضف الاستيراد**

```js
import { isAccountDisabled } from "../../_lib/db.js";
```

- [ ] **Step 3: أضف الفحص بعد نجاح التحقق من كلمة المرور، قبل إنشاء الجلسة**

```js
  if (await isAccountDisabled(env, merchant.merchant_id)) {
    return { error: "هذا الحساب معطّل. تواصل مع فريق هالة." };
  }
```

(استبدل `merchant.merchant_id` بالاسم الفعلي للمتغير كما يظهر بالملف — طابقه مع باقي الدالة، لا تخترع اسم جديد.)

- [ ] **Step 4: تحقق من الصياغة**

Run: `node --check functions/api/auth/login.js`
Expected: بدون مخرجات.

- [ ] **Step 5: Commit**

```bash
git add functions/api/auth/login.js
git commit -m "feat(auth): reject login for accounts.disabled=1"
```

---

### Task 8: نقاط API الأدمن (5 ملفات)

**Files:**
- Create: `functions/api/admin/faq.js`
- Create: `functions/api/admin/bookings.js`
- Create: `functions/api/admin/conversations.js`
- Create: `functions/api/admin/accounts.js`
- Create: `functions/api/admin/overview.js`

**Interfaces:**
- Consumes: `requireAdmin` (Task 4)، كل دوال `db.js` من Task 2، `reembedHalaFaq` (Task 3)، `withApi`/`json` (`respond.js`، موجودة).
- Produces: كل نقطة ترجع `{ok: true, ...}` عند النجاح أو `{ok: false, error, code: "FORBIDDEN"}` لو `requireAdmin` رجعت `null` — نفس نمط الاستجابة المستخدم بباقي المشروع (status 200 دايماً، الفرونت يفحص `.ok`).

- [ ] **Step 1: `functions/api/admin/faq.js`**

```js
// POST /api/admin/faq
// body: { action: "list" } | { action: "save", id?, question, answer } | { action: "delete", id } | { action: "reembed" }
import { withApi } from "../../_lib/respond.js";
import { requireAdmin } from "../../_lib/session.js";
import { listHalaFaq, saveHalaFaqEntry, deleteHalaFaqEntry } from "../../_lib/db.js";
import { reembedHalaFaq } from "../../_lib/memory.js";

async function faqHandler(body, env, request) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };

  const action = body.action;
  if (action === "list") {
    return { ok: true, rows: await listHalaFaq(env) };
  }
  if (action === "save") {
    const question = (body.question || "").toString().trim().slice(0, 500);
    const answer = (body.answer || "").toString().trim().slice(0, 2000);
    if (!question || !answer) return { ok: false, error: "السؤال والجواب مطلوبين." };
    const id = await saveHalaFaqEntry(env, { id: body.id || null, question, answer });
    return { ok: true, id };
  }
  if (action === "delete") {
    if (!body.id) return { ok: false, error: "id مفقود." };
    await deleteHalaFaqEntry(env, body.id);
    return { ok: true };
  }
  if (action === "reembed") {
    const rows = await listHalaFaq(env);
    const count = await reembedHalaFaq(env, rows);
    return { ok: true, reembedded: count };
  }
  return { ok: false, error: "action غير معروف." };
}

export const onRequestPost = withApi(faqHandler);
```

- [ ] **Step 2: `functions/api/admin/bookings.js`**

```js
// POST /api/admin/bookings
// body: { action: "list" } | { action: "setStatus", id, status }
import { withApi } from "../../_lib/respond.js";
import { requireAdmin } from "../../_lib/session.js";
import { listConsultationBookings, setBookingStatus } from "../../_lib/db.js";

const VALID_STATUS = new Set(["pending", "confirmed", "cancelled"]);

async function bookingsHandler(body, env, request) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };

  if (body.action === "list") {
    return { ok: true, rows: await listConsultationBookings(env) };
  }
  if (body.action === "setStatus") {
    if (!body.id || !VALID_STATUS.has(body.status)) {
      return { ok: false, error: "id أو status غير صالح." };
    }
    await setBookingStatus(env, body.id, body.status);
    return { ok: true };
  }
  return { ok: false, error: "action غير معروف." };
}

export const onRequestPost = withApi(bookingsHandler);
```

- [ ] **Step 3: `functions/api/admin/conversations.js`**

```js
// POST /api/admin/conversations — last message per phone for Aura's own WhatsApp line.
import { withApi } from "../../_lib/respond.js";
import { requireAdmin } from "../../_lib/session.js";
import { recentWaConversations } from "../../_lib/db.js";

async function conversationsHandler(body, env, request) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };
  return { ok: true, rows: await recentWaConversations(env, "hala") };
}

export const onRequestPost = withApi(conversationsHandler);
```

- [ ] **Step 4: `functions/api/admin/accounts.js`**

```js
// POST /api/admin/accounts
// body: { action: "list" } | { action: "setDisabled", merchantId, disabled }
import { withApi } from "../../_lib/respond.js";
import { requireAdmin } from "../../_lib/session.js";
import { listAccounts, setAccountDisabled } from "../../_lib/db.js";

async function accountsHandler(body, env, request) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };

  if (body.action === "list") {
    return { ok: true, rows: await listAccounts(env) };
  }
  if (body.action === "setDisabled") {
    if (!body.merchantId) return { ok: false, error: "merchantId مفقود." };
    await setAccountDisabled(env, body.merchantId, Boolean(body.disabled));
    return { ok: true };
  }
  return { ok: false, error: "action غير معروف." };
}

export const onRequestPost = withApi(accountsHandler);
```

- [ ] **Step 5: `functions/api/admin/overview.js`**

```js
// POST /api/admin/overview — dashboard counters only, no raw query surface.
import { withApi } from "../../_lib/respond.js";
import { requireAdmin } from "../../_lib/session.js";
import { adminStats } from "../../_lib/db.js";

async function overviewHandler(body, env, request) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };
  return { ok: true, stats: await adminStats(env), email: admin.email };
}

export const onRequestPost = withApi(overviewHandler);
```

- [ ] **Step 6: تحقق من الصياغة لكل الملفات الخمسة**

Run: `for f in functions/api/admin/*.js; do node --check "$f" || echo "FAIL: $f"; done`
Expected: بدون أي سطر `FAIL:`.

- [ ] **Step 7: Commit**

```bash
git add functions/api/admin/
git commit -m "feat(admin): faq/bookings/conversations/accounts/overview endpoints behind requireAdmin"
```

---

### Task 9: صفحة `admin.html`

**Files:**
- Create: `admin.html`

**Interfaces:**
- Consumes: `<!--#include partials/fouc-theme.html -->` (موجود)، `/api/admin/overview`، `/api/admin/faq`، `/api/admin/bookings`، `/api/admin/conversations`، `/api/admin/accounts` (Task 8).

- [ ] **Step 1: أنشئ `admin.html` — رأس الصفحة + fetch عام + قسم النظرة العامة**

```html
<!DOCTYPE html>
<html dir="rtl" lang="ar" data-shell="product" data-theme="light">
<head>
  <meta charset="utf-8"/>
  <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
  <title>هالة | لوحة أدمن أورا</title>
  <!--#include partials/fouc-theme.html -->
  <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
  <link href="https://fonts.cdnfonts.com/css/din-next-lt-arabic" rel="stylesheet"/>
  <link href="style.css" rel="stylesheet"/>
</head>
<body class="bg-background text-on-background min-h-[100dvh] p-6 max-w-5xl mx-auto">
  <h1 class="text-2xl font-bold mb-1">لوحة أدمن أورا</h1>
  <p id="admin-email" class="text-sm text-outline mb-6"></p>
  <div id="admin-forbidden" class="hidden rounded-xl border border-red-300 bg-red-50 text-red-700 p-4 mb-6">
    ما عندك صلاحية أدمن على هذا الحساب.
  </div>

  <div id="admin-content" class="hidden flex flex-col gap-8">
    <section>
      <h2 class="text-lg font-bold mb-3">نظرة عامة</h2>
      <div id="stats-grid" class="grid grid-cols-2 md:grid-cols-4 gap-3"></div>
    </section>

    <section>
      <h2 class="text-lg font-bold mb-3">حجوزات الاستشارة</h2>
      <div id="bookings-list" class="flex flex-col gap-2"></div>
    </section>

    <section>
      <h2 class="text-lg font-bold mb-3">محادثات واتساب أورا</h2>
      <div id="conversations-list" class="flex flex-col gap-2"></div>
    </section>

    <section>
      <h2 class="text-lg font-bold mb-3">معرفة هالة (RAG)</h2>
      <form id="faq-form" class="flex flex-col gap-2 mb-4 max-w-xl">
        <input id="faq-question" placeholder="السؤال" class="rounded-lg border px-3 py-2" required/>
        <textarea id="faq-answer" placeholder="الجواب" class="rounded-lg border px-3 py-2" rows="3" required></textarea>
        <div class="flex gap-2">
          <button type="submit" class="btn-primary-gradient px-4 py-2 rounded-lg">إضافة</button>
          <button type="button" id="faq-reembed" class="px-4 py-2 rounded-lg border">إعادة تضمين بالذكاء الاصطناعي</button>
        </div>
      </form>
      <div id="faq-list" class="flex flex-col gap-2"></div>
    </section>

    <section>
      <h2 class="text-lg font-bold mb-3">الحسابات</h2>
      <div id="accounts-list" class="flex flex-col gap-2"></div>
    </section>
  </div>

  <script src="theme.js"></script>
  <script>
    async function adminPost(path, body) {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body || {})
      });
      return res.json();
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: أضف سكربت التحميل الأولي (نظرة عامة + رفض الوصول)**

أضف قبل `</body>` (بعد سكربت `adminPost`):

```html
  <script>
    (async function boot() {
      const overview = await adminPost("/api/admin/overview", { action: "overview" });
      if (!overview.ok) {
        document.getElementById("admin-forbidden").classList.remove("hidden");
        return;
      }
      document.getElementById("admin-email").textContent = overview.email;
      document.getElementById("admin-content").classList.remove("hidden");

      const stats = overview.stats;
      document.getElementById("stats-grid").innerHTML = [
        ["متاجر", stats.merchants],
        ["حسابات", stats.accounts],
        ["حجوزات", stats.bookings],
        ["مدخلات معرفة", stats.faqEntries]
      ]
        .map(
          ([label, value]) =>
            `<div class="rounded-xl border p-4 text-center"><div class="text-2xl font-bold">${value}</div><div class="text-xs text-outline">${label}</div></div>`
        )
        .join("");

      loadBookings();
      loadConversations();
      loadFaq();
      loadAccounts();
    })();
  </script>
```

- [ ] **Step 3: أضف سكربت الحجوزات**

```html
  <script>
    async function loadBookings() {
      const res = await adminPost("/api/admin/bookings", { action: "list" });
      if (!res.ok) return;
      const el = document.getElementById("bookings-list");
      if (!res.rows.length) {
        el.innerHTML = '<p class="text-sm text-outline">ما فيه حجوزات بعد.</p>';
        return;
      }
      el.innerHTML = res.rows
        .map(
          (b) => `
        <div class="rounded-lg border p-3 flex items-center justify-between gap-3">
          <div>
            <div class="font-bold">${b.name || "بدون اسم"} — ${b.phone}</div>
            <div class="text-sm text-outline">${b.preferredSlotLabel} · ${b.status}</div>
          </div>
          <div class="flex gap-2">
            <button data-id="${b.id}" data-status="confirmed" class="booking-status-btn text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-700">تأكيد</button>
            <button data-id="${b.id}" data-status="cancelled" class="booking-status-btn text-xs px-2 py-1 rounded bg-red-100 text-red-700">إلغاء</button>
          </div>
        </div>`
        )
        .join("");
      el.querySelectorAll(".booking-status-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await adminPost("/api/admin/bookings", {
            action: "setStatus",
            id: Number(btn.dataset.id),
            status: btn.dataset.status
          });
          loadBookings();
        });
      });
    }
  </script>
```

- [ ] **Step 4: أضف سكربت المحادثات**

```html
  <script>
    async function loadConversations() {
      const res = await adminPost("/api/admin/conversations", {});
      if (!res.ok) return;
      const el = document.getElementById("conversations-list");
      el.innerHTML = res.rows.length
        ? res.rows
            .map(
              (c) => `
        <div class="rounded-lg border p-3">
          <div class="font-bold">${c.phone}</div>
          <div class="text-sm text-outline">${c.lastDirection === "in" ? "← " : "→ "}${(c.lastBody || "").slice(0, 120)}</div>
        </div>`
            )
            .join("")
        : '<p class="text-sm text-outline">ما فيه محادثات بعد.</p>';
    }
  </script>
```

- [ ] **Step 5: أضف سكربت المعرفة (FAQ) وربط النموذج**

```html
  <script>
    async function loadFaq() {
      const res = await adminPost("/api/admin/faq", { action: "list" });
      if (!res.ok) return;
      const el = document.getElementById("faq-list");
      el.innerHTML = res.rows
        .map(
          (r) => `
        <div class="rounded-lg border p-3 flex items-start justify-between gap-3">
          <div>
            <div class="font-bold">${r.question}</div>
            <div class="text-sm text-outline">${r.answer}</div>
          </div>
          <button data-id="${r.id}" class="faq-delete-btn text-xs px-2 py-1 rounded bg-red-100 text-red-700 shrink-0">حذف</button>
        </div>`
        )
        .join("");
      el.querySelectorAll(".faq-delete-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await adminPost("/api/admin/faq", { action: "delete", id: Number(btn.dataset.id) });
          loadFaq();
        });
      });
    }

    document.getElementById("faq-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const question = document.getElementById("faq-question").value.trim();
      const answer = document.getElementById("faq-answer").value.trim();
      if (!question || !answer) return;
      await adminPost("/api/admin/faq", { action: "save", question, answer });
      document.getElementById("faq-form").reset();
      loadFaq();
    });

    document.getElementById("faq-reembed").addEventListener("click", async () => {
      const res = await adminPost("/api/admin/faq", { action: "reembed" });
      alert(res.ok ? `تم تضمين ${res.reembedded} مدخل.` : res.error);
    });
  </script>
```

- [ ] **Step 6: أضف سكربت الحسابات**

```html
  <script>
    async function loadAccounts() {
      const res = await adminPost("/api/admin/accounts", { action: "list" });
      if (!res.ok) return;
      const el = document.getElementById("accounts-list");
      el.innerHTML = res.rows
        .map(
          (a) => `
        <div class="rounded-lg border p-3 flex items-center justify-between gap-3">
          <div>
            <div class="font-bold">${a.email}</div>
            <div class="text-sm text-outline">${a.createdAt}${a.disabled ? " · معطّل" : ""}</div>
          </div>
          <button data-merchant="${a.merchantId}" data-disabled="${!a.disabled}" class="account-toggle-btn text-xs px-2 py-1 rounded border">
            ${a.disabled ? "تفعيل" : "تعطيل"}
          </button>
        </div>`
        )
        .join("");
      el.querySelectorAll(".account-toggle-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await adminPost("/api/admin/accounts", {
            action: "setDisabled",
            merchantId: btn.dataset.merchant,
            disabled: btn.dataset.disabled === "true"
          });
          loadAccounts();
        });
      });
    }
  </script>
```

- [ ] **Step 7: أضف `admin.html` لقائمة الملفات المُنسّقة بـ`scripts/stage.mjs`**

`stage.mjs` ينسخ أي `*.html` بجذر المشروع تلقائياً (`INCLUDE` regex) — لا تعديل مطلوب على السكربت نفسه. تحقق فقط:

Run: `node scripts/stage.mjs && grep -c "admin-content" dist/admin.html`
Expected: رقم ≥ 1 (يؤكد إن `admin.html` انسخ لـ`dist/` والـ`#include` انحل بدون ترك تعليق حي).

- [ ] **Step 8: Commit**

```bash
git add admin.html
git commit -m "feat(admin): admin.html dashboard — overview, bookings, conversations, FAQ CRUD, accounts"
```

---

### Task 10: توثيق الأسرار + فحص حي كامل

**Files:**
- Modify: `README.md`

**Interfaces:**
- لا شي.

- [ ] **Step 1: أضف `ADMIN_EMAILS` لجدول الأسرار بـ`README.md`**

افتح قسم `## الأسرار` وأضف صف جديد:
```
| `ADMIN_EMAILS` | إيميلات مفصولة بفاصلة، تحدد مين يقدر يفتح `/admin.html` — بدون عمود role بقاعدة البيانات |
```

- [ ] **Step 2: تحقق نهائي — `node --check` على كل الملفات المعدّلة/الجديدة**

```bash
for f in functions/_lib/db.js functions/_lib/memory.js functions/_lib/session.js functions/_lib/persona.js functions/api/whatsapp/webhook.js functions/api/support.js functions/api/auth/login.js functions/api/admin/*.js; do
  node --check "$f" || echo "FAIL: $f"
done
```
Expected: بدون أي سطر `FAIL:`.

- [ ] **Step 3: `npm run stage` كامل**

Run: `node scripts/stage.mjs`
Expected: `staged N files into dist/ (includes resolved from partials/)` بدون تحذيرات `#include` غير محلولة.

- [ ] **Step 4: نشر وفحص حي (يتطلب أسرار Cloudflare مضبوطة مسبقاً من المالك)**

```bash
npx wrangler pages deploy dist --project-name hala-ai-os --branch=main
```
بعد النشر، تحقق يدوياً بالمتصفح:
- تسجيل دخول بإيميل **خارج** `ADMIN_EMAILS` → زيارة `/admin.html` → يظهر `admin-forbidden`.
- تسجيل دخول بإيميل **داخل** `ADMIN_EMAILS` → `/admin.html` يحمّل النظرة العامة والأقسام.
- (لو أسرار واتساب مضبوطة) رسالة واتساب حقيقية لرقم أورا → الرد يستخدم `HALA_SUPPORT_PROMPT` + مقطع RAG لو السؤال مطابق لأحد مدخلات `hala_faq`.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document ADMIN_EMAILS secret"
```

---

## مراجعة ذاتية (Self-Review)

- **تغطية المواصفة:** كل بند بـ`docs/superpowers/specs/2026-07-18-hala-whatsapp-admin-design.md` (تصحيح الشخصية، RAG، الحجز، دور الأدمن بدون role، لوحة `admin.html`، القيود الأمنية، `requireAdmin` عبر DB lookup، ترقيم `0006`، `recentWaConversations` الجديدة) له مهمة مطابقة أعلاه — Task 5 يغطي 1+3، Task 2+3 يغطي 2، Task 4 يغطي 4، Task 8+9 يغطي 5.
- **فحص Placeholders:** لا `TBD`/`TODO` بأي خطوة — Task 7 خطوة القراءة اليدوية موثّقة بوضوح لأن اسم المتغير الفعلي بـ`login.js` غير معروف مسبقاً بهذه الخطة (لم يُقرأ الملف بالكامل أثناء التخطيط)، وهذا موصوف كخطوة قراءة صريحة قبل التعديل، مو placeholder مبهم.
- **اتساق الأنواع:** `requireAdmin` يرجع `{merchantId, email} | null` بكل مكان استُخدم (Task 4، Task 8 كل الملفات الخمسة) — مطابق. `saveHalaFaqEntry`/`saveConsultationBooking` يرجعون رقم id بكل الاستخدامات. `status` بـ`consultation_bookings` نفس القيم الثلاث (`pending/confirmed/cancelled`) بكل من الميجريشن، `db.js`، و`admin.html`.

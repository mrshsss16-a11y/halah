// Instagram Platform — مسار "Instagram API with Instagram Login".
// Host: graph.instagram.com · التوكن: Instagram User access token (لكل تاجر).
//
// لماذا هذا المسار وليس Facebook Login: صلاحيات pages_* بتطبيقنا كلها REJECTED
// (متحقَّق حياً 2026-09-06)، ومسار Instagram Login لا يتطلب صفحة فيسبوك مربوطة.
// المرجع الكامل: .claude/skills/instagram-platform/SKILL.md
//
// MULTI-TENANCY: كل حدث وارد يحمل entry[].id = حساب إنستغرام للتاجر (IG_ID).
// هذا **المفتاح الوحيد** الذي يربط الحدث بتاجره — نظيره بواتساب
// value.metadata.phone_number_id، والتعليق بـwhatsapp.js:184 يوثّق العطل الذي
// نتج من إسقاطه (كل الرسائل نُسبت لتاجر واحد مثبّت). لا نكرره هنا.
//
// لا نثق بأي هوية أخرى بالحمولة (from.id, username) إلا بعد التحقق من التوقيع،
// ولا نستخدمها إطلاقاً لاختيار التاجر.
const GRAPH = "https://graph.instagram.com/v25.0";

// SSRF: نفس قاعدة whatsapp.js — أي URL لم يبنِه كودنا يُثبَّت مضيفه **قبل** لصق
// توكن التاجر به. قائمة صريحة، لا أنماط عامة (لا "ينتهي بـinstagram.com" —
// يمرّر evilinstagram.com).
const IG_ALLOWED_HOSTS = new Set([
  "graph.instagram.com",
  "api.instagram.com",
  "www.instagram.com"
]);

function hostAllowed(hostname) {
  if (IG_ALLOWED_HOSTS.has(hostname)) return true;
  // CDN وسائط إنستغرام — نقطة الفصل إلزامية قبل اسم النطاق.
  return hostname.endsWith(".cdninstagram.com") || hostname.endsWith(".fbcdn.net");
}

/**
 * fail closed: يرمي قبل أي طلب لو المخطط ليس https أو المضيف خارج القائمة.
 * يُستدعى **قبل** بناء ترويسة Authorization — لا يُرسَل التوكن إطلاقاً.
 */
export function assertIgUrlAllowed(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    throw new Error("رابط إنستغرام غير صالح — رُفض قبل إرسال أي بيانات اعتماد.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`مخطط غير مسموح (${parsed.protocol}) — رُفض قبل إرسال التوكن.`);
  }
  if (!hostAllowed(parsed.hostname)) {
    throw new Error(`مضيف غير مسموح (${parsed.hostname}) — رُفض قبل إرسال توكن التاجر.`);
  }
  return parsed.toString();
}

/**
 * عقد المحوّل (docs/PARALLEL_TRACKS.md §أ.٣): هل نقدر نتعامل مع هذا التاجر؟
 * لا يرمي هنا — الرمي عند الاستخدام الفعلي.
 * conn = صف ig_connections للتاجر.
 */
export function isConfigured(env, conn = null) {
  return Boolean(conn?.ig_user_id && conn?.access_token);
}

/**
 * تحقق X-Hub-Signature-256 مقابل الجسم الخام.
 *
 * 🔴 السر الموقِّع = App Secret (INSTAGRAM_APP_SECRET)، **وليس** Verify Token —
 * الخلط بينهما خطأ شائع يجعل كل تحقق يفشل صامتاً.
 * منطق مطابق لـverifyWaSignature (whatsapp.js:73): fail closed بلا سر، ومقارنة
 * ثابتة الزمن (لا === على النص — يسرّب طول البادئة المطابقة عبر التوقيت).
 */
export async function verifyIgSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) return false; // fail closed: بلا سر لا يمكن التحقق ⇒ رفض.
  if (!signatureHeader) return false;
  const expected = signatureHeader.replace(/^sha256=/, "");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (computed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/**
 * تحليل تعليقات إنستغرام — يقبل **الشكلين** عمداً.
 *
 * فخ بنيوي موثّق: مسار Instagram Login يرسل الحدث بـ`entry[].field` + `entry[].value`
 * مباشرة، والمعرّف اسمه `value.id`. مسار Facebook Login يرسله داخل `entry[].changes[]`
 * والمعرّف اسمه `comment_id`. أغلب أمثلة الإنترنت للمسار الثاني، وأي مُحلِّل ينسخ منها
 * يقرأ undefined صامتاً. نحلّل الشكلين دفاعياً.
 */
export function parseIgComments(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    const igId = entry?.id || null; // مفتاح ربط التاجر — لا بديل عنه
    // الشكل الأول: value مباشرة على entry (مسارنا)
    const direct = entry?.field === "comments" ? [entry.value] : [];
    // الشكل الثاني: changes[] (مسار Facebook Login)
    const viaChanges = (entry?.changes || [])
      .filter((c) => c?.field === "comments")
      .map((c) => c?.value);

    for (const value of [...direct, ...viaChanges]) {
      if (!value) continue;
      const commentId = value.id || value.comment_id || null;
      if (!commentId) continue; // بلا معرّف لا يمكن الرد ولا إزالة التكرار
      out.push({
        igId,
        kind: "comment",
        commentId,
        parentId: value.parent_id || null,
        mediaId: value?.media?.id || value.original_media_id || null,
        fromId: value?.from?.id || null,
        fromUsername: value?.from?.username || null,
        text: value.text || null
      });
    }
  }
  return out;
}

/**
 * تحليل الرسائل المباشرة.
 *
 * 🔴 is_echo: رسالة أرسلها حسابنا نفسه. بلا تجاهلها يرد البوت على نفسه بحلقة
 * لا نهائية تحرق الحصة. أول شرط، لا استثناء.
 * 🔴 is_deleted: التوثيق يُلزم بحذف الرسالة من طرفنا (Meta Platform Terms) —
 * نُخرجها كحدث منفصل بدل معالجتها كرسالة عادية.
 */
export function parseIgMessages(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    const igId = entry?.id || null;
    for (const event of entry?.messaging || []) {
      const msg = event?.message;
      if (!msg) continue;
      if (msg.is_echo) continue; // رسالتنا نحن — تجاهل مطلق
      const mid = msg.mid || null;
      if (!mid) continue;
      out.push({
        igId,
        kind: "dm",
        mid,
        fromId: event?.sender?.id || null, // IGSID
        text: msg.text || null,
        isDeleted: Boolean(msg.is_deleted),
        isUnsupported: Boolean(msg.is_unsupported),
        attachments: (msg.attachments || []).map((a) => a?.type).filter(Boolean),
        timestamp: event?.timestamp || null
      });
    }
  }
  return out;
}

/**
 * عقد المحوّل: تحقق التوقيع ثم توحيد كل الأحداث.
 * يرمي عند فشل التوقيع — fail closed (S2).
 * الاستدعاء يمرّر الجسم الخام لأن التوقيع يُحسب عليه قبل أي تحليل.
 */
export async function receive(rawBody, signatureHeader, env) {
  const ok = await verifyIgSignature(rawBody, signatureHeader, env.INSTAGRAM_APP_SECRET);
  if (!ok) {
    const err = new Error("instagram: signature verification failed");
    err.status = 401;
    throw err;
  }
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    const err = new Error("instagram: malformed JSON payload");
    err.status = 400;
    throw err;
  }
  return [...parseIgComments(payload), ...parseIgMessages(payload)];
}

// 2026-09-17: مهلة صريحة على كل نداء Graph إنستغرام — WP-A7 (SCALE-2).
const IG_TIMEOUT_MS = 12000;

async function igPost(url, token, body) {
  let res;
  try {
    res = await fetch(assertIgUrlAllowed(url), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(IG_TIMEOUT_MS)
    });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new Error("instagram API timeout — استغرق الطلب أطول من ١٢ ثانية.");
    }
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`instagram API failed: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

/**
 * رد علني تحت التعليق: POST /<IG_COMMENT_ID>/replies
 *
 * قيود Meta الموثّقة: لا رد على تعليق مخفي · لا رد على رد (يُضاف للتعليق الأصلي)
 * · لا رد على تعليقات البث المباشر (استخدم الرد الخاص).
 */
async function replyToComment(conn, { commentId, message }) {
  return igPost(`${GRAPH}/${encodeURIComponent(commentId)}/replies`, conn.access_token, {
    message: String(message).slice(0, 2000)
  });
}

/**
 * رد خاص على معلّق: POST /<IG_ID>/messages مع recipient.comment_id
 *
 * ملاحظة حرجة: `recipient.comment_id` وليس `recipient.id` — هذا ما يحوّل تعليقاً
 * عاماً لمحادثة خاصة.
 * القيود: **مرة واحدة فقط** لكل معلّق · خلال **٧ أيام** من التعليق · لا متابعة
 * إلا إن رد المستخدم (وضمن ٢٤ ساعة من ردّه).
 */
async function sendPrivateReply(conn, { commentId, message }) {
  return igPost(`${GRAPH}/${encodeURIComponent(conn.ig_user_id)}/messages`, conn.access_token, {
    recipient: { comment_id: commentId },
    message: { text: String(message).slice(0, 1000) }
  });
}

/**
 * رسالة مباشرة: POST /<IG_ID>/messages
 * نافذة **٢٤ ساعة** من آخر رسالة للعميل — لا مبادرة إطلاقاً. المحادثة يفتحها العميل.
 */
async function sendDirectMessage(conn, { recipientId, message }) {
  return igPost(`${GRAPH}/${encodeURIComponent(conn.ig_user_id)}/messages`, conn.access_token, {
    recipient: { id: recipientId },
    message: { text: String(message).slice(0, 1000) }
  });
}

/**
 * عقد المحوّل: إرسال موحّد ⇒ **الواجهة العامة الوحيدة للإرسال**.
 *
 * المرحلة ٦: `replyToComment` و`sendPrivateReply` و`sendDirectMessage` لم تعد
 * مُصدَّرة — كانت ثلاثة تصديرات بلا مستورد واحد (قائمة سماح audit-dead-exports)
 * بينما `send` أدناه يستدعيها فعلاً. لا كود ميت ولا سطح تعديل زائف: التوجيه
 * يمرّ من هنا، والوضع (`to.mode`) هو ما يختار الدالة. صفر تغيير سلوكي.
 */
export async function send(env, to, payload) {
  const conn = to?.conn;
  if (!isConfigured(env, conn)) {
    throw new Error("instagram: merchant connection missing or incomplete");
  }
  const message = payload?.text;
  if (!message) throw new Error("instagram: empty message");

  switch (to.mode) {
    case "comment_reply":
      return replyToComment(conn, { commentId: to.commentId, message });
    case "private_reply":
      return sendPrivateReply(conn, { commentId: to.commentId, message });
    case "dm":
      return sendDirectMessage(conn, { recipientId: to.recipientId, message });
    default:
      throw new Error(`instagram: unknown send mode "${to?.mode}"`);
  }
}

// ── اشتراك حساب التاجر بالحقول — **يدوي اليوم، بلوحة Meta** ─────────────────
//
// كان هنا `subscribeToWebhooks(conn, fields)` يستدعي
// `POST /<IG_ID>/subscribed_apps?subscribed_fields=comments,messages`
// (INSTAGRAM_PLAN.md §٤.٣ الخطوة ٢). حُذف بالمرحلة ٦ لأن **نقطة الربط التي
// كانت ستستدعيه غير موجودة**: لا `/api/instagram/install` ولا `/api/instagram/
// callback` بالمستودع (§٤.١ لم يُنفَّذ)، والصفوف تدخل `ig_connections` يدوياً.
// إبقاء الدالة مصدَّرة بلا مستدعٍ كان يوهم أن الاشتراك آلي وهو ليس كذلك
// (قاعدة الصدق، AGENT.md §١١) — والحارس كان يغطّيها باستثناء دائم.
//
// الوضع الحقيقي: الاشتراك يُفعَّل **يدوياً** من لوحة تطبيق Meta
// (INSTAGRAM_PLAN.md §٠.١ + §٤.٣ الخطوة ١). عند تنفيذ §٤.١ يُعاد إحياء النداء
// **داخل الـcallback نفسه** — لا كدالة مصدَّرة بانتظار مستدعٍ.

/**
 * تجديد التوكن طويل الأمد (٦٠ يوماً).
 * ⚠️ يُرفض قبل مرور **٢٤ ساعة** على إصدار التوكن — لا تجدّد فور الإنشاء.
 * بلا cron تجديد: سقوط صامت بعد شهرين (نفس درس توكن واتساب المؤقت).
 */
export async function refreshLongLivedToken(accessToken) {
  const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(accessToken)}`;
  let res;
  try {
    res = await fetch(assertIgUrlAllowed(url), { signal: AbortSignal.timeout(IG_TIMEOUT_MS) });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new Error("instagram token refresh timeout — استغرق الطلب أطول من ١٢ ثانية.");
    }
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`instagram token refresh failed: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  }
  return { accessToken: data.access_token, expiresIn: Number(data.expires_in) || 60 * 24 * 3600 };
}

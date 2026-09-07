// GET  /api/instagram/webhook — مصافحة تحقق Meta (hub.verify_token)
// POST /api/instagram/webhook — تعليقات ورسائل إنستغرام الواردة
//
// المرجع: docs/INSTAGRAM_PLAN.md المرحلة ١ · .claude/skills/instagram-platform/SKILL.md
// النمط المرجعي: functions/api/whatsapp/webhook.js
//
// 🔴 قيد إلزامي (INSTAGRAM_PLAN §٢.٢): **صفر نشر آلي**. كل رد مولَّد يدخل
// review_queue بحالة pending، ولا يُرسل إلا بعد approve() بشرية. إنستغرام منصة
// عامة دائمة — خطأ واحد يبقى تحت المنشور ويُلتقط بلقطة شاشة. وسياسة Meta نفسها
// تصف الرد بوسم الوكيل البشري بأنه **يدوي**، ومراجعة التطبيق تشترط إثبات مسار
// تصعيد بشري — فالبوابة متطلب مُستوفى، لا عبء.
import { getIgConnectionByUserId, claimIgEvent } from "../../_lib/core/db.js";
import { receive } from "../../_lib/integrations/instagram.js";
import { checkAndConsumeMonthly } from "../../_lib/core/meter.js";
import { enqueue } from "../../_lib/services/reviewQueue.js";
import { logError } from "../../_lib/core/errorLog.js";
import { askWorkersAI } from "../../_lib/ai/gateway.js";
import { sanitizeInput } from "../../_lib/core/security.js";
import {
  HALA_WHATSAPP_SUPPORT_PROMPT,
  INSTAGRAM_PUBLIC_COMMENT_RULES,
  INSTAGRAM_DM_RULES
} from "../../_lib/ai/persona.js";

// نوافذ Meta الزمنية — تُخزَّن مع كل عنصر بالطابور ليعرف المراجع كم بقي له.
// Private Reply: ٧ أيام من التعليق، ومرة واحدة فقط لكل معلّق.
// رسالة مباشرة: ٢٤ ساعة من رسالة العميل. لا مبادرة إطلاقاً.
const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 3600 * 1000;
const DM_WINDOW_MS = 24 * 3600 * 1000;

function requestId(context) {
  return context?.request?.headers?.get("cf-ray") || crypto.randomUUID().slice(0, 12);
}

/**
 * مصافحة التحقق. Meta تنادي GET بثلاثة بارامترات؛ نعيد hub.challenge نصاً خاماً
 * فقط لو طابق hub.verify_token سرّنا. أي شيء آخر ⇒ 403.
 * fail closed: غياب INSTAGRAM_VERIFY_TOKEN يرفض كل شيء (S1).
 */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = context.env.INSTAGRAM_VERIFY_TOKEN;
  if (!expected || mode !== "subscribe" || token !== expected || !challenge) {
    return new Response("Forbidden", { status: 403 });
  }
  return new Response(challenge, {
    status: 200,
    headers: { "content-type": "text/plain" }
  });
}

/**
 * توليد مسودة رد. لا ترسل شيئاً — تعيد النص فقط.
 * [SKIP] من النموذج = سبام/إعلان منافس ⇒ لا يدخل الطابور إطلاقاً.
 */
async function draftReply(env, { kind, text, merchantId }) {
  const channelRules = kind === "comment" ? INSTAGRAM_PUBLIC_COMMENT_RULES : INSTAGRAM_DM_RULES;
  const system = `${HALA_WHATSAPP_SUPPORT_PROMPT}\n\n${channelRules}`;

  // تعقيم قبل أي prompt (S7): نص التعليق مدخل غير موثوق من الإنترنت العام —
  // محاولة حقن أوامر عبره تُعامَل كهجوم، لا كرسالة.
  const clean = sanitizeInput(String(text || "").slice(0, 1000));
  if (!clean.trim()) return null;

  // storeId إلزامي: بدونه يعمل الاستدعاء بلا كاش عمداً (عزل المستأجرين) —
  // وتمريره يمنع أن يصل رد تاجر لتاجر آخر من الكاش المشترك.
  const reply = await askWorkersAI({
    env,
    system,
    messages: [{ role: "user", content: clean }],
    storeId: merchantId,
    maxTokens: 300
  });

  const out = String(reply || "").trim();
  if (!out || out.includes("[SKIP]")) return null;
  return out;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const rid = requestId(context);

  // 1) التوقيع على الجسم الخام — قبل أي تحليل (S2). فشل ⇒ 401، لا معالجة.
  let events;
  try {
    const rawBody = await request.text();
    events = await receive(rawBody, request.headers.get("x-hub-signature-256"), env);
  } catch (err) {
    logError(context, {
      requestId: rid,
      path: "instagram/webhook",
      code: err?.status === 401 ? "IG_BAD_SIGNATURE" : "IG_BAD_PAYLOAD",
      internal: err?.message
    });
    return new Response("Unauthorized", { status: err?.status === 400 ? 400 : 401 });
  }

  // 2) نردّ 200 فوراً (شرط Meta)، والمعالجة تكمل بالخلفية.
  // إشعار غير مُجاب عليه بـ200 يُعاد إرساله على مدى ٣٦ ساعة ⇒ تكرار أكثر.
  const work = processEvents(context, events, rid);
  if (context.waitUntil) context.waitUntil(work);
  else await work;

  return new Response("OK", { status: 200 });
}

async function processEvents(context, events, rid) {
  const { env } = context;

  for (const event of events) {
    try {
      // 3) العزل: entry[].id → التاجر. لا مصدر آخر للهوية مقبول (المعيار أ.١).
      const conn = await getIgConnectionByUserId(env, event.igId);
      if (!conn) {
        // حساب غير مربوط عندنا — نتجاهل بصمت (قد يكون اشتراكاً قديماً).
        logError(context, {
          requestId: rid,
          path: "instagram/webhook",
          code: "IG_UNKNOWN_ACCOUNT",
          internal: "no ig_connections row for incoming entry id"
        });
        continue;
      }
      const merchantId = conn.merchant_id;

      // رسالة محذوفة: التزام تعاقدي بحذفها من طرفنا، لا معالجتها كرسالة.
      if (event.isDeleted) continue;
      if (!event.text) continue; // GIF/ملصق/مرفق بلا نص — لا مسودة تُبنى

      // 4) إزالة التكرار قبل استهلاك أي حصة — التكرار **مضمون** لا محتمل
      //    (إعادة محاولة Meta ٣٦ ساعة + دفعات حتى ١٠٠٠).
      const eventId = event.kind === "comment" ? event.commentId : event.mid;
      const isNew = await claimIgEvent(env, { eventId, merchantId, kind: event.kind });
      if (!isNew) continue;

      // 5) الحصة قبل نداء الذكاء (S5) — نفس مسار واتساب.
      const quota = await checkAndConsumeMonthly(env, merchantId, "message").catch((err) => {
        logError(context, {
          requestId: rid,
          path: "instagram/webhook:quota_check",
          code: "QUOTA_CHECK_FAILED",
          internal: err?.message,
          storeId: merchantId
        });
        return null;
      });
      // fail closed هنا عمداً — خلافاً لمسار واتساب: لا عميل ينتظر رداً فورياً
      // (كل شيء يمر بمراجعة بشرية أصلاً)، فتخطي الحصة بلا داعٍ يحرق رصيد التاجر.
      if (!quota || quota.ok === false) continue;

      // 6) المسودة
      const draft = await draftReply(env, {
        kind: event.kind,
        text: event.text,
        merchantId
      });
      if (!draft) continue; // [SKIP] أو نص فارغ

      // 7) الطابور — نقطة النهاية الوحيدة. لا إرسال من هنا إطلاقاً.
      const now = Date.now();
      await enqueue(env, {
        merchantId,
        kind: "social_reply",
        payload: {
          channel: "instagram",
          mode: event.kind === "comment" ? "comment_reply" : "dm",
          igId: event.igId,
          commentId: event.commentId || null,
          recipientId: event.fromId || null,
          fromUsername: event.fromUsername || null,
          sourceText: event.text,
          draft,
          // المراجع يحتاج يعرف كم بقي قبل ما تُغلق النافذة — بدون هذا يوافق
          // على عنصر فات أوانه ويفشل الإرسال بلا سبب مفهوم (INSTAGRAM_PLAN §٢.٣).
          expiresAt: new Date(
            now + (event.kind === "comment" ? PRIVATE_REPLY_WINDOW_MS : DM_WINDOW_MS)
          ).toISOString()
        }
      });
    } catch (err) {
      logError(context, {
        requestId: rid,
        path: "instagram/webhook:process",
        code: "IG_EVENT_FAILED",
        internal: err?.message
      });
    }
  }
}

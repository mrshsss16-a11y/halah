// GET  /api/instagram/webhook — مصافحة تحقق Meta (hub.verify_token)
// POST /api/instagram/webhook — تعليقات ورسائل إنستغرام الواردة
//
// المرجع: docs/INSTAGRAM_PLAN.md المرحلة ١ · .claude/skills/instagram-platform/SKILL.md
// النمط المرجعي: functions/api/whatsapp/webhook.js
//
// تنسيق فقط (ARCHITECTURE §١، المرحلة ٤): تحقق التوقيع ← 200 فوراً ←
// `processIgEvents` بالخلفية. المسودة والطابور بـ`_lib/domain/instagram.js`،
// والبرومبت بـ`_lib/ai/prompts/instagram.js`. معالج خام لأن التوقيع يحتاج
// الجسم الخام — ينتظر `withApi.raw`.
//
// 🔴 قيد إلزامي (INSTAGRAM_PLAN §٢.٢): **صفر نشر آلي**. كل رد مولَّد يدخل
// review_queue بحالة pending، ولا يُرسل إلا بعد approve() بشرية.
import { processIgEvents, receiveIgEvents } from "../../_lib/domain/instagram.js";
import { logError } from "../../_lib/core/errorLog.js";
import { timingSafeEqualStr } from "../../_lib/core/crypto.js";

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
  if (!expected || mode !== "subscribe" || !timingSafeEqualStr(token, expected) || !challenge) {
    return new Response("Forbidden", { status: 403 });
  }
  return new Response(challenge, {
    status: 200,
    headers: { "content-type": "text/plain" }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const rid = requestId(context);

  // 1) التوقيع على الجسم الخام — قبل أي تحليل (S2). فشل ⇒ 401، لا معالجة.
  let events;
  try {
    const rawBody = await request.text();
    events = await receiveIgEvents(rawBody, request.headers.get("x-hub-signature-256"), env);
  } catch (err) {
    // ٤١٣ = سقف الحجم/الدفعة (٣.٣، domain/instagram.js) — قبل أي تحليل.
    const status = err?.status === 413 ? 413 : err?.status === 400 ? 400 : 401;
    logError(context, {
      requestId: rid,
      path: "instagram/webhook",
      code: status === 413 ? "IG_PAYLOAD_TOO_LARGE" : status === 400 ? "IG_BAD_PAYLOAD" : "IG_BAD_SIGNATURE",
      internal: err?.message
    });
    const body = status === 413 ? "Payload Too Large" : status === 400 ? "Bad Request" : "Unauthorized";
    return new Response(body, { status });
  }

  // 2) نردّ 200 فوراً (شرط Meta)، والمعالجة تكمل بالخلفية.
  // إشعار غير مُجاب عليه بـ200 يُعاد إرساله على مدى ٣٦ ساعة ⇒ تكرار أكثر.
  const work = processIgEvents(context, events, rid);
  if (context.waitUntil) context.waitUntil(work);
  else await work;

  return new Response("OK", { status: 200 });
}

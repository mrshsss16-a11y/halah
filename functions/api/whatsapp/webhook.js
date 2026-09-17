// GET  /api/whatsapp/webhook — Meta verification handshake (hub.verify_token)
// POST /api/whatsapp/webhook — inbound customer messages
//
// تنسيق فقط (ARCHITECTURE §١، المرحلة ٤): تحقق التوقيع ← حد معدل ← parse ←
// `handleInboundBatch` داخل waitUntil ← 200. الرد التلقائي وبواباته
// بـ`_lib/domain/whatsappAutoReply.js` و`_lib/domain/whatsappInbound.js`،
// وبرومبت النظام بـ`_lib/ai/prompts/whatsapp.js`.
//
// ملاحظة: هذا معالج **خام** (لا `withApi`) لأن التحقق من التوقيع يحتاج جسم
// الطلب الخام. ينتظر `withApi.raw` (وكيل آخر يضيفه الآن بـcore/respond.js)
// ليتوحّد مسار الأخطاء وسجلّها.
import { handleInboundBatch, verifyInboundSignature, parseInboundPayload } from "../../_lib/domain/whatsappInbound.js";
import { logError } from "../../_lib/core/errorLog.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { timingSafeEqualStr } from "../../_lib/core/crypto.js";
import { readBoundedBody, filterUnseen } from "../../_lib/core/webhookGuard.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = context.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && timingSafeEqualStr(token, expected)) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  // 2026-09-17: سقف الحجم **قبل** حساب الـHMAC — SEC-2 (core/webhookGuard.js).
  const rawBody = await readBoundedBody(request);
  if (rawBody === null) return new Response(JSON.stringify({ error: "payload too large" }), { status: 413, headers: { "content-type": "application/json" } });

  const ok = await verifyInboundSignature(
    rawBody,
    request.headers.get("X-Hub-Signature-256"),
    env.WHATSAPP_APP_SECRET
  );
  if (!ok) return new Response(JSON.stringify({ error: "invalid signature" }), { status: 401, headers: { "content-type": "application/json" } });

  // P21 — second line of defence behind the signature: a leaked app secret (or
  // a compromised Meta-side relay) must not turn into unbounded AI spend. Meta
  // delivers in bursts, so the ceiling is generous; a real flood still stops.
  // Fails OPEN on KV outage (same manager decision as the quota check, P28) —
  // the signature stays the hard gate.
  const flood = await checkRateLimit(env, clientIp(request), "wa_webhook", 600, 60).catch(() => ({ allowed: true }));
  if (!flood.allowed) {
    logError(context, { requestId: null, path: "whatsapp/webhook", code: "WA_WEBHOOK_RATE_LIMITED", internal: "signed webhook flood — 600/min exceeded" });
    return new Response("ok", { status: 200 }); // 200 so Meta does not retry-storm; the burst is dropped, not queued
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("ok", { status: 200 });
  }

  // Coexistence numbers also fire smb_message_echoes for anything a human
  // sends from the WhatsApp Business phone app itself — recorded too so the
  // conversation history/RAG context the bot sees stays complete.
  // Ack immediately; process in the background (Meta expects a fast 200).
  // 2026-09-17: Meta تعيد إرسال الدفعة عند أي تأخر — نرشّح المعرّفات المعالَجة
  // سابقاً فقط، فلا تسقط الرسائل الجديدة بنفس الدفعة معها — SEC-2.
  const { inbound, echoes } = parseInboundPayload(payload);
  context.waitUntil((async () => {
    const seen = (m) => (m?.id ? `wa:${m.id}` : null);
    const batch = { inbound: await filterUnseen(env, inbound, seen), echoes: await filterUnseen(env, echoes, seen) };
    return handleInboundBatch(env, context, batch);
  })());

  return new Response("ok", { status: 200 });
}

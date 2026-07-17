// GET  /api/whatsapp/webhook — Meta verification handshake (hub.verify_token)
// POST /api/whatsapp/webhook — inbound customer messages
//
// Inbound flow: verify X-Hub-Signature-256 → record → auto-reply with the
// marketer persona (this is the "customer-service AI connected to WhatsApp").
// Replies only within the 24h service window (free-form allowed there).
import { verifyWaSignature, parseInbound, sendWaText, waConfigured } from "../../_lib/whatsapp.js";
import { askWorkersAI } from "../../_lib/workersAI.js";
import { PERSONA_SYSTEM_PROMPT, dialectLabel } from "../../_lib/persona.js";
import { recordWaInbound, recordWaOutbound, recentWaHistory, getMarketingContext } from "../../_lib/db.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === context.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

async function autoReply(env, merchantId, phone, incomingText) {
  const ctx = env.DB ? await getMarketingContext(env, merchantId).catch(() => null) : null;
  const dialect = (ctx && ctx.dialect) || "saudi_najdi";
  const instructions = (ctx && ctx.instructions) || "لا توجد تعليمات إضافية.";
  const history = env.DB ? await recentWaHistory(env, merchantId, phone).catch(() => []) : [];

  const system = `${PERSONA_SYSTEM_PROMPT}

---

## سياق واتساب
اللهجة: ${dialectLabel(dialect)} (${dialect})
تعليمات المتجر: ${instructions}
هذي محادثة واتساب حقيقية مع عميل — ردي بإيجاز (سطر أو سطرين)، مباشرة، بدون طلب بيانات دفع.`;

  const turns = history
    .map((m) => ({ role: m.direction === "in" ? "user" : "assistant", content: m.body }))
    .concat([{ role: "user", content: incomingText }])
    .slice(-8);

  return askWorkersAI({ env, system, messages: turns, maxTokens: 300 });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const rawBody = await request.text();

  const ok = await verifyWaSignature(
    rawBody,
    request.headers.get("X-Hub-Signature-256"),
    env.WHATSAPP_APP_SECRET
  );
  if (!ok) return new Response(JSON.stringify({ error: "invalid signature" }), { status: 401 });

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("ok", { status: 200 });
  }

  const merchantId = env.WHATSAPP_MERCHANT_ID || "hala";
  const inbound = parseInbound(payload);

  // Ack immediately; process in the background (Meta expects a fast 200).
  context.waitUntil(
    (async () => {
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
            const reply = await autoReply(env, merchantId, msg.from, msg.text);
            if (reply) {
              const outId = await sendWaText(env, { to: msg.from, body: reply });
              await recordWaOutbound(env, { merchantId, phone: msg.from, body: reply, waMessageId: outId });
            }
          }
        } catch (err) {
          console.error("[wa-webhook]", err);
        }
      }
    })()
  );

  return new Response("ok", { status: 200 });
}

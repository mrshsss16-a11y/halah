// GET  /api/whatsapp/webhook — Meta verification handshake (hub.verify_token)
// POST /api/whatsapp/webhook — inbound customer messages
//
// Inbound flow: verify X-Hub-Signature-256 → record → auto-reply with the
// marketer persona (this is the "customer-service AI connected to WhatsApp").
// Replies only within the 24h service window (free-form allowed there).
import { verifyWaSignature, parseInbound, parseEchoes, sendWaText, waConfigured } from "../../_lib/whatsapp.js";
import { askWorkersAI } from "../../_lib/workersAI.js";
import { PERSONA_SYSTEM_PROMPT, HALA_SUPPORT_PROMPT, BOOKING_INSTRUCTIONS, dialectLabel } from "../../_lib/persona.js";
import { recordWaInbound, recordWaOutbound, recentWaHistory, getMarketingContext, saveConsultationBooking, getLastHumanReplyAt } from "../../_lib/db.js";
import { recallSimilar } from "../../_lib/memory.js";

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

const BOOK_SLOT_RE = /\[BOOK_SLOT:([^\]]+)\]/;
// How long the bot stays quiet on a phone after a human manually replies
// from the WhatsApp Business app, so it doesn't talk over them mid-handoff.
const HUMAN_SILENCE_WINDOW_MS = 2 * 3600 * 1000;

async function autoReply(env, merchantId, phone, incomingText, contactName) {
  const lastHumanReplyAt = env.DB ? await getLastHumanReplyAt(env, merchantId, phone).catch(() => null) : null;
  if (lastHumanReplyAt && Date.now() - new Date(`${lastHumanReplyAt}Z`).getTime() < HUMAN_SILENCE_WINDOW_MS) {
    return null;
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
  // Coexistence numbers also fire smb_message_echoes for anything a human
  // sends from the WhatsApp Business phone app itself — record those too so
  // the conversation history/RAG context the bot sees stays complete instead
  // of silently missing every message the human typed manually.
  const echoes = parseEchoes(payload);

  // Ack immediately; process in the background (Meta expects a fast 200).
  context.waitUntil(
    (async () => {
      for (const echo of echoes) {
        if (!echo.text) continue;
        try {
          await recordWaOutbound(env, { merchantId, phone: echo.to, body: echo.text, waMessageId: echo.id, source: "human" });
        } catch (err) {
          console.error("[wa-webhook-echo]", err);
        }
      }
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
    })()
  );

  return new Response("ok", { status: 200 });
}

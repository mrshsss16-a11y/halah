// GET  /api/whatsapp/webhook — Meta verification handshake (hub.verify_token)
// POST /api/whatsapp/webhook — inbound customer messages
//
// Inbound flow: verify X-Hub-Signature-256 → record → auto-reply with the
// marketer persona (this is the "customer-service AI connected to WhatsApp").
// Replies only within the 24h service window (free-form allowed there).
import { verifyWaSignature, parseInbound, parseEchoes, sendWaText, sendWaInteractiveList, waConfigured } from "../../_lib/whatsapp.js";
import { askWorkersAI } from "../../_lib/workersAI.js";
import { PERSONA_SYSTEM_PROMPT, HALA_SUPPORT_PROMPT, BOOKING_INSTRUCTIONS, ESCALATION_INSTRUCTIONS, WEEKLY_SLOTS, dialectLabel } from "../../_lib/persona.js";
import { recordWaInbound, recordWaOutbound, recentWaHistory, getMarketingContext, saveConsultationBooking, getLastHumanReplyAt, countRecentInboundWithoutResolution } from "../../_lib/db.js";
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
const OFFER_SLOTS_RE = /\[OFFER_SLOTS\]/;
const ESCALATE_RE = /\[ESCALATE\]/;
const ESCALATION_MESSAGE = "حولت طلبك لفريقنا، بيردون عليك قريب 🙌";
const SAFETY_NET_THRESHOLD = 3;
const SAFETY_NET_WINDOW_MINUTES = 60;
// How long the bot stays quiet on a phone after a human manually replies
// from the WhatsApp Business app, so it doesn't talk over them mid-handoff.
const HUMAN_SILENCE_WINDOW_MS = 2 * 3600 * 1000;

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
            } else {
              console.error("[wa-webhook] unmatched list_reply", msg.listReplyId);
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
    })()
  );

  return new Response("ok", { status: 200 });
}

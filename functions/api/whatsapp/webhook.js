// GET  /api/whatsapp/webhook — Meta verification handshake (hub.verify_token)
// POST /api/whatsapp/webhook — inbound customer messages
//
// Inbound flow: verify X-Hub-Signature-256 → record → auto-reply with the
// marketer persona (this is the "customer-service AI connected to WhatsApp").
// Replies only within the 24h service window (free-form allowed there).
import { verifyWaSignature, parseInbound, parseEchoes, sendWaText, sendWaInteractiveList, waConfigured, getWaMedia } from "../../_lib/integrations/whatsapp.js";
import { askWorkersAI, TEXT_MODEL, askVisionAI } from "../../_lib/ai/gateway.js";
import { PERSONA_SYSTEM_PROMPT, HALA_WHATSAPP_SUPPORT_PROMPT, BOOKING_INSTRUCTIONS, ESCALATION_INSTRUCTIONS, WEEKLY_SLOTS, dialectLabel } from "../../_lib/ai/persona.js";
import { recordWaInbound, recordWaOutbound, recentWaHistory, getMarketingContext, saveConsultationBooking, getLastHumanReplyAt, countRecentInboundWithoutResolution, getOmnichannelSession, getWaConnectionByPhoneId } from "../../_lib/core/db.js";
import { recallSimilar } from "../../_lib/ai/memory.js";
import { checkAndConsumeMonthly } from "../../_lib/core/meter.js";
import { matchAuraGreeting, matchFastIntent } from "../../_lib/ai/intents.js";
import { logError } from "../../_lib/core/errorLog.js";
import { checkRateLimit } from "../../_lib/core/rateLimit.js";

// Manager decision 2026-09-06: quota-check errors (D1/KV outage) stay
// fail-OPEN — a transient infra blip must not stop the bot replying to every
// merchant at once. The tradeoff (a few unmetered messages during a rare
// outage) is deliberate. What was missing before: visibility. Every failure
// is now logged, and if it repeats ≥5 times in 10 minutes (a real outage, not
// a blip) a KV flag is set for healthcheck.js to pick up and alert on — see
// docs/AGENT.md §13 and docs/TRACK_B_HALA_EXECUTION.md.
const QUOTA_FAIL_ALERT_KEY = "wa_quota_check_degraded";
const QUOTA_FAIL_ALERT_TTL_SECONDS = 600; // matches the 10-minute window below

async function flagQuotaCheckDegraded(env) {
  if (!env.HALA_CACHE) return;
  await env.HALA_CACHE.put(QUOTA_FAIL_ALERT_KEY, new Date().toISOString(), {
    expirationTtl: QUOTA_FAIL_ALERT_TTL_SECONDS
  }).catch(() => {});
}

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

const DISABLE_ESCALATION_GATES = false;

/**
 * `isAuraLine` = this message arrived on Aura's own support number, so the bot
 * speaks as Hala-the-vendor (consultation booking, escalation to our team).
 * Anything else is a merchant's own connected number, where the bot speaks as
 * THAT store's assistant. Previously this was a literal `merchantId === "hala"`
 * check in seven places, which silently made every merchant Aura.
 */
async function autoReply(env, { merchantId, isAuraLine, phone, incomingText, contactName, context, requestId }) {
  if (!DISABLE_ESCALATION_GATES) {
    const lastHumanReplyAt = env.DB ? await getLastHumanReplyAt(env, merchantId, phone).catch(() => null) : null;
    if (lastHumanReplyAt && Date.now() - new Date(`${lastHumanReplyAt}Z`).getTime() < HUMAN_SILENCE_WINDOW_MS) {
      return null;
    }

    if (env.DB && isAuraLine) {
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
  }

  const history = env.DB ? await recentWaHistory(env, merchantId, phone).catch(() => []) : [];

  // Canned-reply fast path: a plain greeting on the FIRST turn of a
  // conversation costs nothing and answers faster than a model round-trip.
  // Scoped to history.length === 0 so it never talks over an ongoing
  // conversation where "هلا" appears mid-message. Skips quota consumption
  // entirely — no AI call was made, so nothing should be metered.
  if (history.length === 0) {
    const canned = isAuraLine
      ? matchAuraGreeting(incomingText)
      : matchFastIntent(incomingText, "saudi_najdi", { greetingOnly: true });
    if (canned) {
      return { text: canned, offerSlots: false, escalate: false };
    }
  }

  // Merchant monthly message quota (docs/ROADMAP.md m2.2.5) — this path had zero
  // metering before, unlike chat.js/copy.js. "hala" is exempt inside the helper.
  // Quota-exhausted degrades to the same handoff message as an escalation — the
  // END CUSTOMER shouldn't see a "your quota ran out" error, that's the
  // merchant's problem to know about (surfaced via the dashboard usage widget),
  // not something to expose mid-conversation to their customer.
  //
  // Manager decision 2026-09-06: a failed quota CHECK (D1/KV outage, not an
  // exhausted quota) fails OPEN on purpose — see file-header note. Every such
  // failure is logged and counted; ≥5 in 10 minutes flags healthcheck.js.
  const quota = env.DB
    ? await checkAndConsumeMonthly(env, merchantId, "message").catch(async (err) => {
        logError(context, {
          requestId,
          path: "whatsapp/webhook:quota_check",
          code: "QUOTA_CHECK_FAILED",
          internal: err && err.message,
          storeId: merchantId
        });
        const window = await checkRateLimit(env, "system", "wa_quota_check_failure", 5, 600);
        if (!window.allowed) await flagQuotaCheckDegraded(env);
        return { ok: true };
      })
    : { ok: true };
  if (!quota.ok) {
    return { text: ESCALATION_MESSAGE, offerSlots: false, escalate: true };
  }
  // Aura's own knowledge is baked into HALA_WHATSAPP_SUPPORT_PROMPT directly, so
  // skip the RAG round-trip (embedding + Vectorize query) for that branch — it's
  // pure latency with nothing to add, and this path is on a tight response-time
  // budget (WhatsApp, not a website widget where a couple extra seconds is fine).
  const memories =
    isAuraLine ? [] : await recallSimilar({ env, storeId: merchantId, question: incomingText }).catch(() => []);
  const ragContext = memories.length
    ? `\n\n## معرفة ذات صلة (استخدميها لو تساعد بالإجابة، تجاهليها لو مو مرتبطة)\n${memories
        .map((m) => `- س: ${m.question}\n  ج: ${m.reply}`)
        .join("\n")}`
    : "";

  let system;
  if (isAuraLine) {
    system = `${HALA_WHATSAPP_SUPPORT_PROMPT}

---

هذي محادثة واتساب حقيقية — ردي بإيجاز (سطر أو سطرين).

${BOOKING_INSTRUCTIONS}

${ESCALATION_INSTRUCTIONS}`;
  } else {
    const ctx = env.DB ? await getMarketingContext(env, merchantId).catch(() => null) : null;
    // merchantId is mandatory here — the same shopper's number may have a
    // session with several merchants (see getOmnichannelSession).
    const omniSession = env.DB ? await getOmnichannelSession(env, { phone, merchantId }).catch(() => null) : null;
    const dialect = (ctx && ctx.dialect) || "saudi_najdi";
    const instructions = (ctx && ctx.instructions) || "لا توجد تعليمات إضافية.";
    
    let omniContext = "";
    if (omniSession) {
      omniContext = `\n\n## ذاكرة العميل من شات المتجر الإلكتروني
- ملخص محادثة الموقع: ${omniSession.chat_summary || "تصفح واستفسر عن منتجات"}
- المنتج الناقشه بالموقع: ${omniSession.last_product || "غير محدد"}
- طبيعة المحادثة: ${omniSession.theme_category || "استفسار ومبيعات"}
تذكري العميل برحابة صدر، رحبي به واذكري أنك تذكرين استفساره في الموقع بلهجة سعودية دافئة!`;
    }

    system = `${PERSONA_SYSTEM_PROMPT}

---

## سياق واتساب
اللهجة: ${dialectLabel(dialect)} (${dialect})
تعليمات المتجر: ${instructions}
هذي محادثة واتساب حقيقية مع عميل — ردي بإيجاز (سطر أو سطرين)، مباشرة، بدون طلب بيانات دفع.${ragContext}${omniContext}`;
  }

  const turns = history
    .map((m) => ({ role: m.direction === "in" ? "user" : "assistant", content: m.body }))
    .concat([{ role: "user", content: incomingText }])
    .slice(-8);

  let reply = await askWorkersAI({
    env,
    system,
    messages: turns,
    maxTokens: isAuraLine ? 180 : 250,
    model: TEXT_MODEL,
    storeId: merchantId // without this the reply lands in a cache bucket shared by every merchant
  });

  if (isAuraLine && ESCALATE_RE.test(reply)) {
    return { text: ESCALATION_MESSAGE, offerSlots: false, escalate: true };
  }

  let offerSlots = false;
  if (isAuraLine && OFFER_SLOTS_RE.test(reply)) {
    offerSlots = true;
    reply = reply.replace(OFFER_SLOTS_RE, "").trim();
  }

  const bookMatch = reply.match(BOOK_SLOT_RE);
  if (bookMatch && isAuraLine) {
    const slotLabel = bookMatch[1].trim();
    const booking = await saveConsultationBooking(env, { name: contactName || null, phone, slotLabel }).catch(() => null);
    reply = reply.replace(BOOK_SLOT_RE, "").trim();
    if (booking) reply += `\n\nرقم تذكرتك: ${booking.ticketCode} — احتفظ فيه لو رجعت تسأل عن الاستشارة.`;
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
  if (!ok) return new Response(JSON.stringify({ error: "invalid signature" }), { status: 401, headers: { "content-type": "application/json" } });

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("ok", { status: 200 });
  }

  // Aura's own support line — the number in env. Everything else must belong to
  // a merchant who connected their own number via Embedded Signup.
  const auraPhoneId = env.WHATSAPP_PHONE_ID || null;
  const auraMerchantId = env.WHATSAPP_MERCHANT_ID || "hala";

  /**
   * Resolve who a payload belongs to from the number that received it.
   * Returns null for an unknown number so we drop it rather than misattribute
   * a stranger's conversation to a merchant (which would leak it into their
   * history and RAG memory).
   */
  async function routeTo(phoneNumberId) {
    if (!phoneNumberId || (auraPhoneId && String(phoneNumberId) === String(auraPhoneId))) {
      return { merchantId: auraMerchantId, isAuraLine: true, conn: null };
    }
    const conn = await getWaConnectionByPhoneId(env, phoneNumberId);
    if (conn) return { merchantId: conn.merchant_id, isAuraLine: false, conn };
    console.error("[wa-webhook] unknown phone_number_id, dropping:", phoneNumberId);
    return null;
  }

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
          const route = await routeTo(echo.phoneNumberId);
          if (!route) continue;
          await recordWaOutbound(env, { merchantId: route.merchantId, phone: echo.to, body: echo.text, waMessageId: echo.id, source: "human" });
        } catch (err) {
          console.error("[wa-webhook-echo]", err);
        }
      }
      for (const msg of inbound) {
        try {
          const route = await routeTo(msg.phoneNumberId);
          if (!route) continue;
          const { merchantId, isAuraLine, conn } = route;

          // Customer tapped a list row — deterministic booking, no model round-trip.
          if (msg.listReplyId != null && isAuraLine) {
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
              const booking = await saveConsultationBooking(env, { name: msg.name || null, phone: msg.from, slotLabel }).catch(() => null);
              const ticketLine = booking ? `\nرقم تذكرتك: ${booking.ticketCode} — احتفظ فيه لو رجعت تسأل عن الاستشارة.` : "";
              const confirmText = `تم حجز استشارتك ${slotLabel} ✅ فريقنا بيتواصل معك بالوقت المحدد.${ticketLine}`;
              const outId = await sendWaText(env, { to: msg.from, body: confirmText, conn });
              await recordWaOutbound(env, { merchantId, phone: msg.from, body: confirmText, waMessageId: outId, source: "bot" });
            } else {
              console.error("[wa-webhook] unmatched list_reply", msg.listReplyId);
            }
            continue;
          }

          if (msg.type === "audio" && msg.audioId) {
            try {
              const audioBuffer = await getWaMedia(env, msg.audioId, conn);
              // Wrap the ArrayBuffer in Uint8Array since Workers AI expects it
              const transcript = await env.AI.run('@cf/openai/whisper', { audio: [...new Uint8Array(audioBuffer)] });
              msg.text = transcript.text;
            } catch (err) {
              console.error("[wa-webhook-audio]", err);
            }
          }

          if (msg.type === "image" && msg.imageId) {
            try {
              const imageBuffer = await getWaMedia(env, msg.imageId, conn);
              const prompt = msg.imageCaption || "صف هذه الصورة بالتفصيل للمساعدة في الرد على استفسار العميل.";
              const visionText = await askVisionAI({ env, imageBuffer, prompt });
              // Treat the vision output as text context for the RAG autoReply.
              msg.text = `[أرسل العميل صورة. التفاصيل: ${visionText}]\n${msg.imageCaption ? `رسالة العميل: ${msg.imageCaption}` : ""}`;
            } catch (err) {
              console.error("[wa-webhook-image]", err);
            }
          }

          if (!msg.text) continue;

          await recordWaInbound(env, {
            merchantId,
            phone: msg.from,
            name: msg.name,
            body: msg.text,
            waMessageId: msg.id
          });

          if (waConfigured(env, conn)) {
            const result = await autoReply(env, {
              merchantId,
              isAuraLine,
              phone: msg.from,
              incomingText: msg.text,
              contactName: msg.name,
              context,
              requestId: `wa:${msg.id}`
            });
            if (!result) continue;

            if (result.text) {
              const outId = await sendWaText(env, { to: msg.from, body: result.text, conn });
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
                rows,
                conn
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

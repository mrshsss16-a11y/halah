// استقبال دفعة واتساب: التوجيه بالرقم المستقبِل، الأصداء، والوسائط
// (صوت/صورة) ثم `autoReply`. نُقل من `api/whatsapp/webhook.js` بالمرحلة ٤ بلا
// تغيير سلوكي — الويبهوك يستدعي `handleInboundBatch` داخل waitUntil فقط.
import { sendWaText, sendWaInteractiveList, waConfigured, getWaMedia } from "../integrations/whatsapp.js";
import { askVisionAI } from "../ai/gateway.js";
import { WEEKLY_SLOTS } from "../ai/persona.js";
import { logError } from "../core/errorLog.js";
import { recordWaInbound, recordWaOutbound, getWaConnectionByPhoneId } from "./whatsapp.js";
import { saveConsultationBooking } from "./booking.js";
import { autoReply } from "./whatsappAutoReply.js";

/**
 * Resolve who a payload belongs to from the number that received it.
 * Returns null for an unknown number so we drop it rather than misattribute
 * a stranger's conversation to a merchant (which would leak it into their
 * history and RAG memory).
 */
export async function routeInbound(env, context, phoneNumberId) {
  // Aura's own support line — the number in env. Everything else must belong to
  // a merchant who connected their own number via Embedded Signup.
  const auraPhoneId = env.WHATSAPP_PHONE_ID || null;
  const auraMerchantId = env.WHATSAPP_MERCHANT_ID || "hala";

  if (!phoneNumberId || (auraPhoneId && String(phoneNumberId) === String(auraPhoneId))) {
    return { merchantId: auraMerchantId, isAuraLine: true, conn: null };
  }
  const conn = await getWaConnectionByPhoneId(env, phoneNumberId);
  if (conn) return { merchantId: conn.merchant_id, isAuraLine: false, conn };
  logError(context, { requestId: null, path: "whatsapp/webhook", code: "WA_UNKNOWN_PHONE_ID", internal: `unknown phone_number_id ${phoneNumberId} — event dropped` });
  return null;
}

/**
 * كل ما كان داخل `waitUntil` بالويبهوك: الأصداء أولاً ثم الرسائل الواردة،
 * بنفس الترتيب حرفياً — الترتيب هنا ليس تفصيلاً: صدى رد بشري يجب أن يُسجَّل
 * قبل معالجة رسالة العميل التالية وإلا فتحت نافذة الصمت متأخرة.
 */
export async function handleInboundBatch(env, context, { inbound, echoes }) {
  for (const echo of echoes) {
    if (!echo.text) continue;
    try {
      const route = await routeInbound(env, context, echo.phoneNumberId);
      if (!route) continue;
      await recordWaOutbound(env, { merchantId: route.merchantId, phone: echo.to, body: echo.text, waMessageId: echo.id, source: "human" });
    } catch (err) {
      logError(context, { requestId: `wa:${echo.id}`, path: "whatsapp/webhook", code: "WA_ECHO_RECORD_FAILED", internal: err?.message || String(err) });
    }
  }
  for (const msg of inbound) {
    // `merchantId` معرَّف خارج الـtry عمداً: سجل الفشل بالأسفل يذكره، وكان
    // بالنسخة السابقة داخل الـtry فيرمي ReferenceError داخل الـcatch نفسه
    // ويُسقط بقية الدفعة بصمت. (تصحيح مرافق للنقل — لا يغيّر أي مسار ناجح.)
    let merchantId = null;
    try {
      const route = await routeInbound(env, context, msg.phoneNumberId);
      if (!route) continue;
      const { isAuraLine, conn } = route;
      merchantId = route.merchantId;

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
          logError(context, { requestId: `wa:${msg.id}`, path: "whatsapp/webhook", code: "WA_UNMATCHED_LIST_REPLY", internal: `list_reply id ${msg.listReplyId}`, storeId: merchantId });
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
          logError(context, { requestId: `wa:${msg.id}`, path: "whatsapp/webhook", code: "WA_AUDIO_TRANSCRIBE_FAILED", internal: err?.message || String(err), storeId: merchantId });
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
          logError(context, { requestId: `wa:${msg.id}`, path: "whatsapp/webhook", code: "WA_IMAGE_VISION_FAILED", internal: err?.message || String(err), storeId: merchantId });
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
      logError(context, { requestId: `wa:${msg.id}`, path: "whatsapp/webhook", code: "WA_MESSAGE_HANDLING_FAILED", internal: err?.message || String(err), storeId: merchantId });
    }
  }
}

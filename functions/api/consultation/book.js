// POST /api/consultation/book — body: { name, phone, slotLabel }
// Public endpoint backing consultation.html's booking form. No admin/session
// required — anyone can request a free consultation slot, same as the
// WhatsApp booking flow in whatsapp/webhook.js (both call the same
// saveConsultationBooking, single source of truth for ticket codes).
import { withApi, json } from "../../_lib/core/respond.js";
import { saveConsultationBooking } from "../../_lib/domain/booking.js";
import { sanitizeInput } from "../../_lib/core/security.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";

const PHONE_RE = /^\+?\d{9,15}$/;

async function bookHandler(body, env, request) {
  const ip = clientIp(request);
  // 2026-09-17: fail-closed — نقطة عامة بلا جلسة تكتب صفوفاً بالقاعدة، فعطل KV
  // بلا حدّ يعني إغراق حجوزات بلا سقف. رفض مؤقت أرخص من سجل مسموم — SEC-9.
  const rateCheck = await checkRateLimit(env, ip, "consultation_book", 5, 300, { failClosed: true });
  if (!rateCheck.allowed) {
    return json({ ok: false, error: `محاولات كثيرة جداً. حاول بعد ${rateCheck.resetInSeconds} ثانية.` }, 429);
  }

  const name = sanitizeInput((body.name || "").toString().trim(), 100);
  const phone = (body.phone || "").toString().trim().replace(/[\s-]/g, "");
  const slotLabel = sanitizeInput((body.slotLabel || "").toString().trim(), 50);

  if (!phone || !PHONE_RE.test(phone)) {
    return json({ ok: false, error: "أدخل رقم جوال صحيح." }, 400);
  }
  if (!slotLabel) {
    return json({ ok: false, error: "اختر موعداً." }, 400);
  }
  if (!env.DB) {
    return json({ ok: false, error: "الحجز غير متاح حالياً." }, 503);
  }

  const booking = await saveConsultationBooking(env, { name: name || null, phone, slotLabel });

  return json({
    ok: true,
    ticketCode: booking.ticketCode,
    name: name || null,
    phone,
    slotLabel
  });
}

export const onRequestPost = withApi(bookHandler);

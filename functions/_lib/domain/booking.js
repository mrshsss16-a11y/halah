// مجال حجوزات الاستشارة (`consultation_bookings`).
// نُقل من core/db.js بالمرحلة ٣ بلا تغيير سلوكي.
import { sanitizeInput } from "../core/security.js";
import { sendWaText, waConfigured } from "../integrations/whatsapp.js";

export async function saveConsultationBooking(env, { name, phone, slotLabel }) {
  // Chokepoint sanitize: the WhatsApp path (whatsapp/webhook.js) passes the
  // sender's raw WhatsApp profile name and a model-emitted slot label straight
  // in, and both render in the admin bookings table (SECURITY_AUDIT C3/H3).
  // book.js already sanitizes, so this is idempotent there and closes the gap
  // for every other caller in one place.
  const cleanName = name ? sanitizeInput(String(name), 100) : null;
  const cleanSlot = slotLabel ? sanitizeInput(String(slotLabel), 50) : slotLabel;
  const res = await env.DB.prepare(
    "INSERT INTO consultation_bookings (name, phone, preferred_slot_label) VALUES (?, ?, ?)"
  )
    .bind(cleanName, phone, cleanSlot)
    .run();

  const id = res.meta.last_row_id;
  const ticketCode = `AURA-${String(id).padStart(5, "0")}`;

  await env.DB.prepare("UPDATE consultation_bookings SET ticket_code = ? WHERE id = ?")
    .bind(ticketCode, id)
    .run()
    .catch(() => {});

  return { id, ticketCode };
}

export async function listConsultationBookings(env, limit = 100) {
  const { results } = await env.DB.prepare(
    "SELECT id, name, phone, preferred_slot_label, status, created_at FROM consultation_bookings ORDER BY created_at DESC LIMIT ?"
  )
    .bind(limit)
    .all();
  return (results || []).map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    preferredSlotLabel: r.preferred_slot_label,
    status: r.status,
    createdAt: r.created_at
  }));
}

export async function setBookingStatus(env, id, status) {
  await env.DB.prepare("UPDATE consultation_bookings SET status = ? WHERE id = ?")
    .bind(status, id)
    .run();
}

// ── تذكيرات الاستشارة (المرحلة ٤: نُقل من api/cron/reminders.js) ────────────
// الوظيفة كاملة هنا لأنها منطق أعمال خالص: أي فتحة يقابلها الوقت بعد ٣٠ دقيقة،
// من يستحق تذكيراً، ونص التذكير. نقطة الدخول تبقى حارساً + استدعاء واحد.

/**
 * تسمية الفتحة بعد ٣٠ دقيقة بتوقيت الرياض، بنفس صيغة `WEEKLY_SLOTS`
 * (persona.js): «الأحد ١٠ص». الجمعة/السبت خارج الفتحات ⇒ null.
 */
export function targetSlotLabel(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("ar-SA", {
    timeZone: "Asia/Riyadh", weekday: "long", hour: "numeric", hour12: true
  }).formatToParts(new Date(now + 30 * 60000));

  let weekday = "", hour = "", dayPeriod = "";
  for (const part of parts) {
    if (part.type === "weekday") weekday = part.value;
    if (part.type === "hour") hour = part.value;
    if (part.type === "dayPeriod") dayPeriod = part.value;
  }

  const DAYS = new Set(["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس"]);
  if (!DAYS.has(weekday)) return null;

  // ar-SA قد تُخرج "ص"/"صباحًا" — نطبّعها لحرف واحد كما بالفتحات.
  const period = dayPeriod.startsWith("ص") ? "ص" : "م";
  let arHour = hour;
  if (hour === "10" || hour === "١٠") arHour = "١٠";
  if (hour === "12" || hour === "١٢") arHour = "١٢";
  return `${weekday} ${arHour}${period}`;
}

/**
 * الحجوزات المستحقة للتذكير بهذه الفتحة. `reminder_sent_at` يمنع التكرار —
 * تسمية الفتحة بدقة الساعة، فبدونه يتكرر التذكير كل تِك لقرابة ساعة.
 * tenant-audit-ok: طابور cron عابر للمتاجر بالتصميم (حجوزات أورا نفسها).
 */
export async function dueReminders(env, slotLabel, limit = 20) {
  const { results } = await env.DB.prepare(
    `SELECT id, ticket_code, name, phone, preferred_slot_label
       FROM consultation_bookings
      WHERE (status = 'pending' OR status IS NULL)
        AND preferred_slot_label = ?
        AND reminder_sent_at IS NULL
      LIMIT ?`
  )
    .bind(slotLabel, limit)
    .all();
  return results || [];
}

/** يختم الحجز مُذكَّراً. الابتلاع منقول كما كان: فشل الختم لا يوقف الدفعة. */
export async function markReminderSent(env, id) {
  await env.DB.prepare("UPDATE consultation_bookings SET reminder_sent_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run()
    .catch(() => {});
}

/** رقم تذكرة الحجز. P18: العمود هو المصدر الوحيد؛ الاشتقاق احتياطي لصفوف ما قبل 0009. */
export function ticketOf(booking) {
  return booking.ticket_code || `AURA-${String(booking.id).padStart(5, "0")}`;
}

// ── المرحلة ٦ (ق٦): `api/**` لا يستورد `integrations/**` ────────────────────
/** هل قناة التذكير (واتساب) مضبوطة؟ نفس شرط `waConfigured` السابق بالتِك. */
export function reminderChannelReady(env) {
  return waConfigured(env);
}

/** تذكير واحد. الأخطاء تُبتلع كما كانت (`.catch(() => {})`) فلا يوقف التِك. */
export async function sendReminderMessage(env, { to, body }) {
  return sendWaText(env, { to, body }).catch(() => {});
}

// مجال حجوزات الاستشارة (`consultation_bookings`).
// نُقل من core/db.js بالمرحلة ٣ بلا تغيير سلوكي.
import { sanitizeInput } from "../core/security.js";

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

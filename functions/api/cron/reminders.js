// GET /api/cron/reminders
// Automated 30-Minute WhatsApp Appointment Reminders Cron Trigger
import { sendWaText, waConfigured } from "../../_lib/integrations/whatsapp.js";

function getTargetSlotLabel() {
  // Saudi Arabia is UTC+3
  // Target time is 30 minutes from now
  const targetTime = new Date(Date.now() + 30 * 60000);
  
  // Create an Intl formatter for Riyadh time
  const options = { timeZone: 'Asia/Riyadh', weekday: 'long', hour: 'numeric', hour12: true };
  const formatter = new Intl.DateTimeFormat('ar-SA', options);
  const parts = formatter.formatToParts(targetTime);
  
  let weekday = "";
  let hour = "";
  let dayPeriod = "";
  
  for (const part of parts) {
    if (part.type === 'weekday') weekday = part.value;
    if (part.type === 'hour') hour = part.value;
    if (part.type === 'dayPeriod') dayPeriod = part.value;
  }
  
  // Map standard ar-SA weekdays to our exact labels if necessary
  const dayMap = {
    "الأحد": "الأحد",
    "الاثنين": "الاثنين",
    "الثلاثاء": "الثلاثاء",
    "الأربعاء": "الأربعاء",
    "الخميس": "الخميس"
  };
  
  // Normalize AM/PM to our format (ص / م)
  // ar-SA might output "ص" or "م" or "صباحًا"
  const period = dayPeriod.startsWith('ص') ? 'ص' : 'م';
  
  const day = dayMap[weekday];
  if (!day) return null; // Friday/Saturday not in WEEKLY_SLOTS
  
  // Map Arabic numerals if necessary, though we just output them
  // Or match the exact format used in WEEKLY_SLOTS, e.g. "الأحد ١٠ص" or "الاثنين 10ص"
  // The persona.js uses Arabic numerals for numbers? Let's assume standard numerals for the match.
  // Actually, persona.js has "الأحد ١٠ص" (Arabic digits). 
  // Let's create a mapper for 10 and 12
  let arHour = hour;
  if (hour === "10" || hour === "١٠") arHour = "١٠";
  if (hour === "12" || hour === "١٢") arHour = "١٢";

  return `${day} ${arHour}${period}`;
}

export async function onRequestGet(context) {
  const { env, request } = context;

  // Public GET, no session — must fail closed on a shared secret or anyone
  // on the internet could trigger arbitrary WhatsApp sends to booked customers.
  if (!env.CRON_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: "CRON_SECRET not configured" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
  const authHeader = request.headers.get("Authorization") || "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (provided !== env.CRON_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" }
    });
  }

  if (!env.DB) {
    return new Response(JSON.stringify({ ok: false, error: "Database DB binding missing" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }

  try {
    const targetSlot = getTargetSlotLabel();
    if (!targetSlot) {
      return new Response(JSON.stringify({ ok: true, msg: "No slots on this day/time" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    // Find bookings for the target slot (30 mins from now). reminder_sent_at
    // guards against re-sending — getTargetSlotLabel() is hour-granularity, so
    // the same booking would otherwise match on every run for close to an hour.
    const query = `
      SELECT id, name, phone, preferred_slot_label
      FROM consultation_bookings
      WHERE (status = 'pending' OR status IS NULL)
        AND preferred_slot_label = ?
        AND reminder_sent_at IS NULL
      LIMIT 20
    `;
    const { results } = await env.DB.prepare(query).bind(targetSlot).all();

    let sent = 0;
    if (waConfigured(env) && results && results.length) {
      const employeePhone = env.STORE_WA_PHONE || env.MERCHANT_WA_PHONE || "966500000000"; // Fallback to a default if not set

      for (const booking of results) {
        const ticket = `AURA-${String(booking.id).padStart(5, "0")}`;
        const name = booking.name ? `أهلاً ${booking.name}` : "أهلاً بك";
        
        // Reminder for Client
        const clientReminder = `تذكير: موعد استشارتك ${booking.preferred_slot_label} بعد 30 دقيقة 🙌 (تذكرة: ${ticket})`;
        
        // Reminder for Employee
        const employeeReminder = `تذكير للموظف: لديك استشارة مع ${booking.name || booking.phone} بعد 30 دقيقة 🙌 (الفتحة: ${booking.preferred_slot_label}) (تذكرة: ${ticket})`;

        // Send to Client
        await sendWaText(env, {
          to: booking.phone,
          body: clientReminder
        }).catch(() => {});

        // Send to Employee
        await sendWaText(env, {
          to: employeePhone,
          body: employeeReminder
        }).catch(() => {});

        await env.DB.prepare("UPDATE consultation_bookings SET reminder_sent_at = datetime('now') WHERE id = ?")
          .bind(booking.id)
          .run()
          .catch(() => {});

        sent++;
      }
    }

    return new Response(JSON.stringify({ ok: true, targetSlot, remindersChecked: results ? results.length : 0, remindersSent: sent }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
}

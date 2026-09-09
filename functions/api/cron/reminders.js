// GET /api/cron/reminders — تذكير واتساب قبل موعد الاستشارة بـ٣٠ دقيقة.
// يُضرب كل ١٠ دقائق من `cron-worker/`.
//
// المرحلة ٤: تنسيق فقط — حارس السر المشترك ووجود DB بـ`withApi.raw`،
// ومنطق الفتحة والاستحقاق بـ`domain/booking.js`. نفس الرسائل والحالات.
import { withApi } from "../../_lib/core/respond.js";
import { targetSlotLabel, dueReminders, markReminderSent, ticketOf,
         reminderChannelReady, sendReminderMessage } from "../../_lib/domain/booking.js";
import { logError } from "../../_lib/core/errorLog.js";
import { recordHeartbeat } from "../../_lib/core/heartbeat.js";

const NOT_CONFIGURED = "خدمة التذكيرات غير مفعّلة حالياً على الخادم.";

async function remindersHandler(request, env, requestId, context) {
  const log = (code, internal) => logError(context, { requestId, path: "cron/reminders", code, internal });

  try {
    const targetSlot = targetSlotLabel();
    if (!targetSlot) return { ok: true, msg: "No slots on this day/time" };

    const bookings = await dueReminders(env, targetSlot);
    let sent = 0;

    if (reminderChannelReady(env) && bookings.length) {
      // لا رقم موظف مفبرك (§١١ / P49): غيابه يتخطى تذكير الموظف ويُسجَّل مرة
      // واحدة لكل تِك — وتذكير العميل يخرج على أي حال.
      const employeePhone = env.STORE_WA_PHONE || env.MERCHANT_WA_PHONE || null;
      if (!employeePhone) {
        log("EMPLOYEE_PHONE_MISSING", "STORE_WA_PHONE/MERCHANT_WA_PHONE not configured — employee reminders skipped");
      }

      for (const booking of bookings) {
        const ticket = ticketOf(booking);
        await sendReminderMessage(env, {
          to: booking.phone,
          body: `تذكير: موعد استشارتك ${booking.preferred_slot_label} بعد 30 دقيقة 🙌 (تذكرة: ${ticket})`
        });

        if (employeePhone) {
          await sendReminderMessage(env, {
            to: employeePhone,
            body: `تذكير للموظف: لديك استشارة مع ${booking.name || booking.phone} بعد 30 دقيقة 🙌 (الفتحة: ${booking.preferred_slot_label}) (تذكرة: ${ticket})`
          });
        }

        await markReminderSent(env, booking.id);
        sent++;
      }
    }

    await recordHeartbeat(env, { job: "reminders", ok: true, note: `sent=${sent}` });
    return { ok: true, targetSlot, remindersChecked: bookings.length, remindersSent: sent };
  } catch (err) {
    // خام `err.message` قد يحمل نص SQL أو رد واتساب (أرقام عملاء) — للسجل فقط.
    log("CRON_REMINDERS_FAILED", String((err && err.stack) || err));
    await recordHeartbeat(env, { job: "reminders", ok: false, note: "CRON_REMINDERS_FAILED" });
    return json500(requestId);
  }
}

function json500(requestId) {
  return new Response(
    JSON.stringify({ ok: false, error: "تعذّر تنفيذ التذكيرات. حاول مرة ثانية بعد شوي.", code: "CRON_REMINDERS_FAILED", requestId }),
    { status: 500, headers: { "content-type": "application/json" } }
  );
}

export const onRequestGet = withApi.raw(remindersHandler, {
  csrf: false, cron: true, requireDb: true, cronMessage: NOT_CONFIGURED, logPath: "cron/reminders"
});

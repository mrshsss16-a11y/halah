// POST /api/admin/bookings
// body: { action: "list" } | { action: "setStatus", id, status }
import { withApi } from "../../_lib/core/respond.js";
import { requireAdmin } from "../../_lib/core/session.js";
import { listConsultationBookings, setBookingStatus } from "../../_lib/core/db.js";

const VALID_STATUS = new Set(["pending", "confirmed", "cancelled"]);

async function bookingsHandler(body, env, request) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };

  if (body.action === "list") {
    return { ok: true, rows: await listConsultationBookings(env) };
  }
  if (body.action === "setStatus") {
    if (!body.id || !VALID_STATUS.has(body.status)) {
      return { ok: false, error: "id أو status غير صالح." };
    }
    await setBookingStatus(env, body.id, body.status);
    return { ok: true };
  }
  return { ok: false, error: "action غير معروف." };
}

export const onRequestPost = withApi(bookingsHandler);

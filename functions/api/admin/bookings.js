// POST /api/admin/bookings
// body: { action: "list" } | { action: "setStatus", id, status }
import { withApi } from "../../_lib/core/respond.js";
import { recordAdminAction } from "../../_lib/core/auditLog.js";
import { requireAdmin } from "../../_lib/core/session.js";
import { listConsultationBookings, setBookingStatus } from "../../_lib/domain/booking.js";

const VALID_STATUS = new Set(["pending", "confirmed", "cancelled"]);

async function bookingsHandler(body, env, request, requestId, context) {
  const admin = await requireAdmin(request, env);
  if (!admin) return { ok: false, error: "غير مصرح.", code: "FORBIDDEN" };
  // P9 — سطر تدقيق: من قرأ/عدّل ماذا ومتى (migrations/0023 audit_log).
  recordAdminAction(context, { admin, action: String(body.action || "read"), path: new URL(request.url).pathname, targetMerchantId: body.merchantId || body.storeId || null, requestId });

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

// GET /api/auth/google_client — معرّف عميل Google العلني من سر GOOGLE_CLIENT_ID.
// مصدر واحد: كان المعرّف مكتوباً بـlogin.html فانفصل عن السر وعن عميل قوقل الفعلي
// (origin_mismatch على عميل لا نملك حسابه، 2026-09-14). المعرّف علني بطبيعته — ليس Client Secret.
import { json } from "../../_lib/core/respond.js";

export async function onRequestGet({ env }) {
  const clientId = String(env?.GOOGLE_CLIENT_ID || "").trim();
  if (!clientId) return json({ ok: false, error: "تسجيل الدخول بجوجل غير مفعّل حالياً.", code: "GOOGLE_NOT_CONFIGURED" }, 503, { "Cache-Control": "no-store" });
  return json({ ok: true, clientId }, 200, { "Cache-Control": "no-store" });
}

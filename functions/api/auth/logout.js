// POST /api/auth/logout — clears the session cookie.
import { json } from "../../_lib/core/respond.js";
import { sessionCookieHeader } from "../../_lib/core/session.js";

export async function onRequestPost() {
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookieHeader("", { clear: true }) });
}

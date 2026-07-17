// POST /api/auth/logout — clears the session cookie.
import { json } from "../../_lib/respond.js";
import { sessionCookieHeader } from "../../_lib/session.js";

export async function onRequestPost() {
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookieHeader("", { clear: true }) });
}

// POST /api/auth/complete_account — body: { email, password }
//
// The second half of the "option ب" flow (project owner, 2026-09-07): a Salla
// merchant installs the app, gets a session from /api/auth/salla_embedded and
// browses the dashboard immediately with NO account of ours. The first real
// operation (copy/image/bulk upload/publish/whatsapp connect/chat) returns
// 403 ACCOUNT_REQUIRED (see requireCompletedAccount in _lib/core/session.js),
// and the dashboard sends the merchant here.
//
// SECURITY: merchantId comes from the SESSION COOKIE ONLY — never from the
// body. Accepting a client-supplied merchant_id here would let anyone attach
// their own email+password to another merchant's Salla store, i.e. a full
// takeover of that tenant.
import { json } from "../../_lib/core/respond.js";
import { assertTrustedWrite } from "../../_lib/core/csrf.js";
import { hashPassword } from "../../_lib/core/auth.js";
import { getSessionMerchantId } from "../../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { isAdminEmail } from "../../_lib/core/adminEmails.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost(context) {
  const { request, env } = context;
  // P42 — CSRF gate (Origin allowlist + JSON-only body) for this raw handler.
  try {
    assertTrustedWrite(request, env);
  } catch (err) {
    return json({ ok: false, error: err.message, code: err.code || "CSRF_REJECTED" }, err.status || 403);
  }

  const rl = await checkRateLimit(env, clientIp(request), "complete_account", 5, 3600);
  if (!rl.allowed) {
    return json(
      { ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" },
      429
    );
  }

  const merchantId = await getSessionMerchantId(request, env);
  if (!merchantId) {
    return json({ ok: false, error: "سجّل دخولك أولاً.", code: "LOGIN_REQUIRED" }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "طلب غير صالح." }, 400);
  }

  const email = (body.email || "").toString().trim().toLowerCase().slice(0, 200);
  const password = (body.password || "").toString();

  if (!EMAIL_RE.test(email)) {
    return json({ ok: false, error: "أدخل بريد إلكتروني صحيح." }, 400);
  }
  if (password.length < 8) {
    return json({ ok: false, error: "كلمة المرور لازم تكون ٨ أحرف على الأقل." }, 400);
  }

  // P38 — same rule as signup.js: this endpoint also INSERTs into `accounts`,
  // so an ADMIN_EMAILS address here would mint a full admin (attached to a
  // Salla merchant, no less). Same generic 409 to avoid enumeration.
  if (isAdminEmail(env, email)) {
    return json({ ok: false, error: "هذا البريد مسجّل مسبقاً — سجّل دخول بدل ذلك." }, 409);
  }

  // The merchant row must actually exist (it does for any Salla install); fail
  // closed rather than creating an orphan account for a stale session.
  const merchant = await env.DB.prepare("SELECT id FROM merchants WHERE id = ?")
    .bind(merchantId)
    .first();
  if (!merchant) {
    return json({ ok: false, error: "المتجر غير موجود.", code: "MERCHANT_NOT_FOUND" }, 404);
  }

  const mine = await env.DB.prepare("SELECT email FROM accounts WHERE merchant_id = ?")
    .bind(merchantId)
    .first();
  if (mine) {
    return json({ ok: false, error: "حسابك مكتمل مسبقاً.", code: "ACCOUNT_EXISTS" }, 409);
  }

  // tenant-audit-ok: uniqueness check on the global email column — an email may
  // belong to at most one merchant, so this lookup is deliberately not scoped.
  const taken = await env.DB.prepare("SELECT merchant_id FROM accounts WHERE email = ?")
    .bind(email)
    .first();
  if (taken) {
    return json({ ok: false, error: "هذا البريد مسجّل مسبقاً — سجّل دخول بدل ذلك." }, 409);
  }

  // The 20-seat TRIAL_MERCHANT_CAP in signup.js is deliberately NOT applied
  // here. That cap limits how many NEW merchants we let in the door; this
  // merchant is already inside — Salla installed the app, the `merchants` row
  // exists and consumes shared AI capacity either way. Enforcing the cap here
  // would strand an installed Salla merchant in a permanent dead end (blocked
  // from every real operation, with no way to unblock), which is exactly the
  // Easy-Mode experience Salla reviews. Gate installs at the webhook if the
  // cap ever needs to apply to Salla merchants.

  const { hash, salt } = await hashPassword(password);
  await env.DB.prepare(
    "INSERT INTO accounts (merchant_id, email, password_hash, password_salt) VALUES (?, ?, ?, ?)"
  )
    .bind(merchantId, email, hash, salt)
    .run();

  // Session cookie is already valid and already carries this merchantId — no
  // need to re-issue it.
  return json({ ok: true, storeId: merchantId, email });
}

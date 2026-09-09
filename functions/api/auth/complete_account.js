// POST /api/auth/complete_account — body: { email, password }
//
// The second half of the "option ب" flow (project owner, 2026-09-07): a Salla
// merchant installs the app, gets a session from /api/auth/salla_embedded and
// browses the dashboard with NO account of ours. The first real operation
// returns 403 ACCOUNT_REQUIRED (requireCompletedAccount in core/session.js) and
// the dashboard sends the merchant here.
//
// SECURITY: merchantId comes from the SESSION COOKIE ONLY — never from the
// body. Accepting a client-supplied merchant_id would let anyone attach their
// own email+password to another merchant's Salla store (full tenant takeover).
//
// TRIAL_MERCHANT_CAP (signup.js) is deliberately NOT applied here: that cap
// limits NEW merchants at the door, and this one is already inside (Salla
// installed the app). Enforcing it would strand an installed merchant in a
// permanent dead end. Gate installs at the webhook if it ever must apply.
import { withApi, json } from "../../_lib/core/respond.js";
import { hashPassword } from "../../_lib/core/auth.js";
import { getSessionMerchantId } from "../../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { isAdminEmail } from "../../_lib/core/adminEmails.js";
import { EMAIL_RE } from "../../_lib/core/security.js";
import { merchantExists, accountEmailFor, emailTaken, completeAccount } from "../../_lib/domain/accounts.js";

async function completeAccountHandler(body, env, request) {
  const rl = await checkRateLimit(env, clientIp(request), "complete_account", 5, 3600, { failClosed: true });
  if (!rl.allowed) {
    return json({ ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" }, 429);
  }

  const merchantId = await getSessionMerchantId(request, env);
  if (!merchantId) return json({ ok: false, error: "سجّل دخولك أولاً.", code: "LOGIN_REQUIRED" }, 401);

  const email = (body.email || "").toString().trim().toLowerCase().slice(0, 200);
  const password = (body.password || "").toString();

  if (!EMAIL_RE.test(email)) return json({ ok: false, error: "أدخل بريد إلكتروني صحيح." }, 400);
  if (password.length < 8) {
    return json({ ok: false, error: "كلمة المرور لازم تكون ٨ أحرف على الأقل." }, 400);
  }

  // P38 — same rule as signup.js: this endpoint also INSERTs into `accounts`,
  // so an ADMIN_EMAILS address here would mint a full admin. Generic 409.
  if (isAdminEmail(env, email)) {
    return json({ ok: false, error: "هذا البريد مسجّل مسبقاً — سجّل دخول بدل ذلك." }, 409);
  }

  // The merchant row must actually exist (it does for any Salla install); fail
  // closed rather than creating an orphan account for a stale session.
  if (!(await merchantExists(env, merchantId))) {
    return json({ ok: false, error: "المتجر غير موجود.", code: "MERCHANT_NOT_FOUND" }, 404);
  }
  if (await accountEmailFor(env, merchantId)) {
    return json({ ok: false, error: "حسابك مكتمل مسبقاً.", code: "ACCOUNT_EXISTS" }, 409);
  }
  if (await emailTaken(env, email)) {
    return json({ ok: false, error: "هذا البريد مسجّل مسبقاً — سجّل دخول بدل ذلك." }, 409);
  }

  const { hash, salt } = await hashPassword(password);
  await completeAccount(env, { merchantId, email, hash, salt });

  // Session cookie is already valid and already carries this merchantId.
  return json({ ok: true, storeId: merchantId, email });
}

export const onRequestPost = withApi(completeAccountHandler);

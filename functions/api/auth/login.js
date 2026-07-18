// POST /api/auth/login — body: { email, password }
import { json } from "../../_lib/respond.js";
import { verifyPassword } from "../../_lib/auth.js";
import { createSessionToken, sessionCookieHeader } from "../../_lib/session.js";
import { isAccountDisabled } from "../../_lib/db.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "طلب غير صالح." }, 400);
  }

  const email = (body.email || "").toString().trim().toLowerCase().slice(0, 200);
  const password = (body.password || "").toString();

  const account = await env.DB.prepare("SELECT * FROM accounts WHERE email = ?").bind(email).first();
  if (!account || !(await verifyPassword(password, account.password_hash, account.password_salt))) {
    return json({ ok: false, error: "البريد أو كلمة المرور غير صحيحة." }, 401);
  }

  if (await isAccountDisabled(env, account.merchant_id)) {
    return json({ ok: false, error: "هذا الحساب معطّل. تواصل مع فريق هالة." }, 403);
  }

  const merchant = await env.DB.prepare("SELECT store_name FROM merchants WHERE id = ?")
    .bind(account.merchant_id)
    .first();

  const token = await createSessionToken(env, account.merchant_id);
  return json(
    { ok: true, storeId: account.merchant_id, email, storeName: merchant && merchant.store_name },
    200,
    { "Set-Cookie": sessionCookieHeader(token) }
  );
}

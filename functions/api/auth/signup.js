// POST /api/auth/signup — body: { email, password, storeName? }
// Creates a merchant + account, sets the session cookie. One step, two
// fields — minimum friction (Commitment & Consistency: small first ask).
import { json } from "../../_lib/core/respond.js";
import { hashPassword } from "../../_lib/core/auth.js";
import { createSessionToken, sessionCookieHeader } from "../../_lib/core/session.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const storeName = (body.storeName || "").toString().trim().slice(0, 100) || null;

  if (!EMAIL_RE.test(email)) {
    return json({ ok: false, error: "أدخل بريد إلكتروني صحيح." }, 400);
  }
  if (password.length < 8) {
    return json({ ok: false, error: "كلمة المرور لازم تكون ٨ أحرف على الأقل." }, 400);
  }

  const existing = await env.DB.prepare("SELECT merchant_id FROM accounts WHERE email = ?")
    .bind(email)
    .first();
  if (existing) {
    return json({ ok: false, error: "هذا البريد مسجّل مسبقاً — سجّل دخول بدل ذلك." }, 409);
  }

  const merchantId = `m_${crypto.randomUUID().slice(0, 12)}`;
  const { hash, salt } = await hashPassword(password);

  await env.DB.batch([
    env.DB.prepare("INSERT INTO merchants (id, store_name) VALUES (?, ?)").bind(merchantId, storeName),
    env.DB.prepare(
      "INSERT INTO accounts (merchant_id, email, password_hash, password_salt) VALUES (?, ?, ?, ?)"
    ).bind(merchantId, email, hash, salt)
  ]);

  const token = await createSessionToken(env, merchantId);
  return json(
    { ok: true, storeId: merchantId, email },
    200,
    { "Set-Cookie": sessionCookieHeader(token) }
  );
}

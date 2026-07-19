import { getAccountEmail } from "./db.js";
import { ApiError } from "./respond.js";

// Signed session cookie — no DB round trip to verify. Token shape:
// `${merchantId}.${expiryUnix}.${hmacHex}`, HMAC-SHA256(SESSION_SECRET, `${merchantId}.${expiryUnix}`).
// Same signing pattern as the Salla webhook signature check (functions/api/webhooks/salla.js)
// for consistency: timing-safe compare, Web Crypto only.
const COOKIE_NAME = "hala_session";
const SESSION_DAYS = 30;

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(env, merchantId) {
  const expiry = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 3600;
  const payload = `${merchantId}.${expiry}`;
  const mac = await hmacHex(env.SESSION_SECRET, payload);
  return `${payload}.${mac}`;
}

export async function verifySessionToken(env, token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [merchantId, expiryStr, mac] = parts;
  const expiry = Number(expiryStr);
  if (!merchantId || !Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return null;
  const expectedMac = await hmacHex(env.SESSION_SECRET, `${merchantId}.${expiryStr}`);
  if (!timingSafeEqual(mac, expectedMac)) return null;
  return merchantId;
}

export function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const map = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) map[key] = decodeURIComponent(value);
  });
  return map;
}

export function sessionCookieHeader(token, { clear = false } = {}) {
  const maxAge = clear ? 0 : SESSION_DAYS * 24 * 3600;
  const value = clear ? "" : token;
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function getSessionMerchantId(request, env) {
  if (!env.SESSION_SECRET) return null;
  const cookies = parseCookies(request);
  return verifySessionToken(env, cookies[COOKIE_NAME]);
}

/**
 * The core tenant-isolation rule, two layers:
 *
 * 1. A valid session cookie always wins over whatever storeId the client
 *    claims in the request body — a logged-in attacker can never operate on
 *    someone else's store by swapping ids.
 * 2. With no session, a claimed storeId is only honored when that store has
 *    NO account attached. Stores created via the Salla Easy-Mode install have
 *    no login — their unguessable id (m_ + 96 random bits truncated) is their
 *    only credential, so it must keep working. But the moment a merchant
 *    signs up, their data is reachable exclusively through a session: a
 *    leaked/guessed id alone gets 401 LOGIN_REQUIRED.
 *
 * The anonymous demo flow ("default-store") is untouched.
 */
export async function resolveStoreId(request, env, claimedStoreId) {
  const sessionMerchantId = await getSessionMerchantId(request, env);
  if (sessionMerchantId) return sessionMerchantId;
  const claimed = (claimedStoreId || "default-store").toString().slice(0, 40);
  if (claimed !== "default-store" && (await getAccountEmail(env, claimed))) {
    throw new ApiError(401, "هذا المتجر مرتبط بحساب — سجّل دخولك للوصول له.", "LOGIN_REQUIRED");
  }
  return claimed;
}

/**
 * Admin gate: session token only carries merchantId (see resolveStoreId
 * above), never email — so this looks up the account's email in D1 and
 * checks it against the ADMIN_EMAILS secret. No role column anywhere:
 * there is no code path that can grant admin by writing to the DB, only
 * by editing the Cloudflare secret.
 */
export async function requireAdmin(request, env) {
  const merchantId = await getSessionMerchantId(request, env);
  if (!merchantId) return null;
  const email = await getAccountEmail(env, merchantId);
  if (!email) return null;
  const allow = (env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!allow.includes(email.toLowerCase())) return null;
  return { merchantId, email };
}

export { COOKIE_NAME };

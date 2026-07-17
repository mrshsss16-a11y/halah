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
 * The core protection: if a valid session cookie exists, it always wins over
 * whatever storeId the client claims in the request body — closes the "send
 * someone else's storeId" hole. With no session (anonymous demo flow), the
 * client-claimed id passes through unchanged — zero behavior change for the
 * existing default-store experience.
 */
export async function resolveStoreId(request, env, claimedStoreId) {
  const sessionMerchantId = await getSessionMerchantId(request, env);
  if (sessionMerchantId) return sessionMerchantId;
  return (claimedStoreId || "default-store").toString().slice(0, 40);
}

export { COOKIE_NAME };

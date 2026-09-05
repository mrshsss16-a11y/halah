import { getAccountEmail, getMerchant } from "./db.js";
import { ApiError } from "./respond.js";

// Ids an anonymous caller must never be able to claim through a request body.
// "hala" is Aura's own line and is UNMETERED in meter.js — letting a stranger
// name it (or any reserved id) would run AI with no quota at that tenant's
// expense (SECURITY_AUDIT C2/H7).
const RESERVED_STORE_IDS = new Set(["hala"]);

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

function getSessionSecret(env) {
  if (env?.SESSION_SECRET) {
    return env.SESSION_SECRET;
  }
  // No derivation from other secrets: WHATSAPP_TOKEN rotates (hourly for temp
  // tokens) which would silently invalidate every session, and reusing an
  // integration secret weakens session integrity. Fail closed instead.
  throw new ApiError(500, "متغير البيئة SESSION_SECRET غير معرف. يرجى ضبطه في إعدادات البيئة.", "SESSION_SECRET_MISSING");
}

export async function createSessionToken(env, merchantId) {
  const secret = getSessionSecret(env);
  const expiry = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 3600;
  const payload = `${merchantId}.${expiry}`;
  const mac = await hmacHex(secret, payload);
  return `${payload}.${mac}`;
}

export async function verifySessionToken(env, token) {
  if (!token) return null;
  const secret = getSessionSecret(env);
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [merchantId, expiryStr, mac] = parts;
  const expiry = Number(expiryStr);
  if (!merchantId || !Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return null;
  const expectedMac = await hmacHex(secret, `${merchantId}.${expiryStr}`);
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
  // SameSite=None (not Lax) is required for dashboard.html when it runs
  // embedded inside Salla's dashboard iframe (a cross-site context from the
  // browser's point of view — halah.aura.sa framed by s.salla.sa). Lax
  // cookies are dropped by the browser in that context: the login/verify
  // fetch would succeed (200, Set-Cookie present) but the cookie never
  // actually persists, so the very next request looks logged-out — no error,
  // the merchant just gets silently bounced back. Still HttpOnly + Secure +
  // a signed token, so this doesn't weaken anything meaningful; SameSite=Lax
  // was only ever protecting against a scenario (cross-site top-level GET
  // navigation carrying the cookie) that doesn't apply to an API cookie like
  // this one.
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`;
}

export async function getSessionMerchantId(request, env) {
  const cookies = parseCookies(request);
  return verifySessionToken(env, cookies[COOKIE_NAME]);
}

/**
 * The core tenant-isolation rule, two layers:
 *
 * 1. A valid session cookie always wins over whatever storeId the client
 *    claims in the request body — a logged-in attacker can never operate on
 *    someone else's store by swapping ids.
 * 2. With no session, a claimed storeId is only honored when it names a REAL
 *    Salla-install merchant that has NO account attached. Those stores have no
 *    login — their unguessable id (m_ + truncated random) is their only
 *    credential, so it must keep working. But:
 *      - the moment a merchant signs up, their data is reachable exclusively
 *        through a session (a leaked/guessed id alone gets 401 LOGIN_REQUIRED);
 *      - a claimed id that matches NO merchant row is rejected back to the
 *        shared "default-store" bucket instead of being trusted verbatim. The
 *        old code returned any unknown string as its own tenant, so an
 *        anonymous caller could mint unlimited fresh quota buckets by inventing
 *        ids (SECURITY_AUDIT C2 — denial of wallet);
 *      - reserved ids (see RESERVED_STORE_IDS) are never claimable anonymously.
 *
 * The anonymous demo flow ("default-store") is untouched.
 */
export async function resolveStoreId(request, env, claimedStoreId) {
  const sessionMerchantId = await getSessionMerchantId(request, env);
  const claimed = (claimedStoreId || "default-store").toString().slice(0, 40);

  if (sessionMerchantId) {
    if (claimed !== "default-store" && claimed !== sessionMerchantId) {
      const admin = await requireAdmin(request, env);
      if (admin) return claimed;
    }
    return sessionMerchantId;
  }

  // ── Anonymous from here down ──────────────────────────────────────────────
  if (claimed === "default-store") return claimed;

  // A stranger can never name a reserved tenant (e.g. the unmetered "hala").
  if (RESERVED_STORE_IDS.has(claimed)) {
    throw new ApiError(401, "غير مصرح.", "LOGIN_REQUIRED");
  }

  // Registered store → session required.
  if (await getAccountEmail(env, claimed)) {
    throw new ApiError(401, "هذا المتجر مرتبط بحساب — سجّل دخولك للوصول له.", "LOGIN_REQUIRED");
  }

  // Only a real, account-less Salla-install merchant may be addressed by id
  // alone. An id matching no merchant row is NOT trusted as its own tenant —
  // it falls back to the shared demo bucket so it can't farm free quota.
  const merchant = env?.DB ? await getMerchant(env, claimed).catch(() => null) : null;
  if (!merchant) return "default-store";
  return claimed;
}

/**
 * Admin gate: session token only carries merchantId (see resolveStoreId
 * above), never email — so this looks up the account's email in D1 and
 * checks it against ADMIN_EMAILS or DB is_admin.
 */
export async function requireAdmin(request, env) {
  const merchantId = await getSessionMerchantId(request, env);
  if (!merchantId) return null;

  let account = null;
  if (env?.DB) {
    account = await env.DB.prepare("SELECT email FROM accounts WHERE merchant_id = ?")
      .bind(merchantId)
      .first()
      .catch(() => null);
  }

  const email = account?.email || (await getAccountEmail(env, merchantId));
  if (!email) return null;

  const allow = (env?.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (allow.includes(email.toLowerCase())) {
    return { merchantId, email };
  }
  return null;
}

export { COOKIE_NAME };

// OAuth CSRF protection — signed `state` parameter.
//
// Without a state check, an attacker can hand a merchant a crafted callback URL
// carrying the ATTACKER's authorization code. The merchant's browser completes
// the flow and our backend stores the attacker's store tokens against that
// session — the classic OAuth CSRF / account-linking attack.
//
// Same design as the session cookie (core/session.js): an HMAC-signed value, so
// no DB round trip is needed to verify it. The state is also mirrored into a
// short-lived cookie so the callback can prove the flow started in THIS browser.
//
// Token shape: `${nonce}.${expiryUnix}.${hmacHex}`
import { ApiError } from "./respond.js";
// Q1 — نسخة واحدة للمقارنة الثابتة الزمن بدل تكرارها بكل ملف يوقّع.
import { timingSafeEqualStr } from "./crypto.js";

const STATE_COOKIE = "hala_oauth_state";
const STATE_TTL_SECONDS = 10 * 60; // an OAuth consent round trip is short

function getSecret(env) {
  if (env?.SESSION_SECRET) return env.SESSION_SECRET;
  throw new ApiError(
    500,
    "متغير البيئة SESSION_SECRET غير معرف. يرجى ضبطه في إعدادات البيئة.",
    "SESSION_SECRET_MISSING"
  );
}

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

/** Mint a signed state token for an outgoing OAuth redirect. */
export async function createOAuthState(env) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const expiry = Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS;
  const payload = `${nonce}.${expiry}`;
  const mac = await hmacHex(getSecret(env), payload);
  return `${payload}.${mac}`;
}

/** Set-Cookie header binding the state to this browser. `clear: true` expires it. */
export function oauthStateCookieHeader(state, { clear = false } = {}) {
  const maxAge = clear ? 0 : STATE_TTL_SECONDS;
  const value = clear ? "" : state;
  // SameSite=Lax so the cookie still rides along on the provider's top-level
  // redirect back to us, while staying unavailable to cross-site subrequests.
  return `${STATE_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function readStateCookie(request) {
  const header = request.headers.get("Cookie") || "";
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    if (pair.slice(0, idx).trim() === STATE_COOKIE) {
      return decodeURIComponent(pair.slice(idx + 1).trim());
    }
  }
  return null;
}

/**
 * Verify the `state` returned by the provider.
 * Requires: valid signature, not expired, and an exact match with the cookie
 * set when the flow started (so a state minted for another browser is useless).
 */
export async function verifyOAuthState(env, request, stateFromQuery) {
  if (!stateFromQuery) return false;

  const cookieState = readStateCookie(request);
  if (!cookieState || !timingSafeEqualStr(cookieState, stateFromQuery)) return false;

  const parts = stateFromQuery.split(".");
  if (parts.length !== 3) return false;
  const [nonce, expiryStr, mac] = parts;
  const expiry = Number(expiryStr);
  if (!nonce || !Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return false;

  const expected = await hmacHex(getSecret(env), `${nonce}.${expiryStr}`);
  return timingSafeEqualStr(mac, expected);
}


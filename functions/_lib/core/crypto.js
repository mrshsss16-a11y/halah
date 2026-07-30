// AES-256-GCM encryption at rest for third-party platform credentials
// (Salla OAuth tokens, Trendyol API keys) stored in D1. Without this, a D1
// dump/leak would hand over every connected merchant's live platform
// credentials in plain text. Key comes from the ENCRYPTION_KEY Cloudflare
// secret (32 raw bytes, base64-encoded) — never hardcoded, same pattern as
// SESSION_SECRET.
// Versioned prefix on every encrypted value. Rows written before encryption
// at rest (or by any future format) are detected by the absence/mismatch of
// this prefix, so legacy plaintext credentials keep working unchanged instead
// of silently decrypting to null and 401-ing every connected merchant.
const ENC_PREFIX = "enc:v1:";

async function importKey(env) {
  if (!env.ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY secret is missing — add it with `wrangler pages secret put ENCRYPTION_KEY`.");
  }
  const raw = Uint8Array.from(atob(env.ENCRYPTION_KEY), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Encrypts plaintext, returns "enc:v1:<iv-base64>:<ciphertext-base64>". Passes through null/"" (as null) so optional columns stay nullable; undefined is normalized to null so a D1 bind never sees it. */
export async function encryptSecret(env, plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === "") return plaintext ?? null;
  const key = await importKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(String(plaintext)));
  return `${ENC_PREFIX}${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

/**
 * Decrypts a value produced by encryptSecret. Values without the enc:v1:
 * prefix are legacy plaintext rows written before encryption at rest — they
 * are returned unchanged (they get re-encrypted on the next save via the
 * normal saveTokens/savePlatformConnection paths). Returns null only for
 * missing input or a corrupted/foreign-key ciphertext, never throws.
 */
export async function decryptSecret(env, payload) {
  if (payload === null || payload === undefined || payload === "") return null;
  const s = String(payload);
  if (!s.startsWith(ENC_PREFIX)) return s;
  const parts = s.slice(ENC_PREFIX.length).split(":");
  if (parts.length !== 2) return null;
  try {
    const key = await importKey(env);
    const iv = base64ToBytes(parts[0]);
    const ciphertext = base64ToBytes(parts[1]);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

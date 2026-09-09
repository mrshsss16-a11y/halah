// Password hashing — PBKDF2-SHA256 via Web Crypto (crypto.subtle), no
// external dependency. 100k iterations, 16-byte random salt, 256-bit output.
const ITERATIONS = 100_000;

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function deriveBits(password, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const derived = await deriveBits(password, saltBytes);
  return { hash: bytesToHex(derived), salt: bytesToHex(saltBytes) };
}

/**
 * Q3 — مصدر واحد لتجزئة رمز الاستعادة (كانت نسختان متطابقتان بـforgot_password
 * وreset_password؛ أي انحراف بينهما يكسر كل استعادة بصمت). SHA-256 لـ
 * `${email}:${otp}` — مملّح بالبريد فما ينفع رمز حساب لحساب آخر.
 */
export async function hashOtp(email, otp) {
  const data = new TextEncoder().encode(`${email}:${otp}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyPassword(password, hash, salt) {
  const derived = await deriveBits(password, hexToBytes(salt));
  const computed = bytesToHex(derived);
  if (computed.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

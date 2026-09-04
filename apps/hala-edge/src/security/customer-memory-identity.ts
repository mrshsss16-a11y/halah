type CustomerMemoryIdentityPayload = Readonly<{
  version: 1;
  profileId: string;
  organizationId: string;
  storeConnectionId: string;
  issuedAt: number;
  expiresAt: number;
}>;

function encode(value: string): string {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decode(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const padded = value
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    return atob(padded);
  } catch {
    return null;
  }
}

async function signingKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error("customer_memory_secret_invalid");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signature(input: string, secret: string): Promise<string> {
  const bytes = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    new TextEncoder().encode(input)
  );
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function issueCustomerMemoryIdentity(input: {
  profileId: string;
  organizationId: string;
  storeConnectionId: string;
  secret: string;
  now?: number;
  ttlSeconds?: number;
}): Promise<string> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const ttl = input.ttlSeconds ?? 60 * 60 * 24 * 30;
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 60 * 60 * 24 * 180)
    throw new Error("customer_memory_identity_ttl_invalid");
  const payload: CustomerMemoryIdentityPayload = {
    version: 1,
    profileId: input.profileId,
    organizationId: input.organizationId,
    storeConnectionId: input.storeConnectionId,
    issuedAt: now,
    expiresAt: now + ttl
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return `v1.${encodedPayload}.${await signature(encodedPayload, input.secret)}`;
}

export async function verifyCustomerMemoryIdentity(input: {
  token: string;
  organizationId: string;
  storeConnectionId: string;
  secret: string;
  now?: number;
}): Promise<CustomerMemoryIdentityPayload | null> {
  const parts = input.token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const encodedPayload = parts[1];
  const providedSignature = parts[2];
  if (encodedPayload === undefined || providedSignature === undefined) return null;
  if (!/^[a-f0-9]{64}$/u.test(providedSignature)) return null;
  const expectedSignature = await signature(encodedPayload, input.secret);
  if (providedSignature.length !== expectedSignature.length) return null;
  const valid = providedSignature === expectedSignature;
  if (!valid) return null;
  const decoded = decode(encodedPayload);
  if (decoded === null) return null;
  let payload: CustomerMemoryIdentityPayload;
  try {
    payload = JSON.parse(decoded) as CustomerMemoryIdentityPayload;
  } catch {
    return null;
  }
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (
    payload.version !== 1 ||
    payload.organizationId !== input.organizationId ||
    payload.storeConnectionId !== input.storeConnectionId ||
    payload.expiresAt <= now ||
    payload.issuedAt > now + 60
  )
    return null;
  return payload;
}

export type HmacVerificationResult =
  | Readonly<{ kind: "valid" }>
  | Readonly<{ kind: "invalid_secret" }>
  | Readonly<{ kind: "invalid_signature" }>;

function toHex(bytes: Uint8Array): string {
  let value = "";

  for (const byte of bytes) {
    value += byte.toString(16).padStart(2, "0");
  }

  return value;
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

export async function verifyHmacSha256(
  rawBody: Uint8Array,
  secret: string,
  suppliedSignature: string | undefined
): Promise<HmacVerificationResult> {
  const normalizedSecret = secret.trim();
  const normalizedSignature = suppliedSignature?.trim().replace(/^sha256=/i, "") ?? "";

  if (normalizedSecret.length === 0) {
    return { kind: "invalid_secret" };
  }

  if (normalizedSignature.length === 0) {
    return { kind: "invalid_signature" };
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(normalizedSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, rawBody);
  const expectedSignature = toHex(new Uint8Array(digest));

  return timingSafeEqual(expectedSignature, normalizedSignature)
    ? { kind: "valid" }
    : { kind: "invalid_signature" };
}

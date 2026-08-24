const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

export type PasswordDigest = Readonly<{
  algorithm: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  hash: string;
}>;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }

  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");

  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations
    },
    material,
    HASH_BYTES * 8
  );

  return new Uint8Array(bits);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftByte = left[index];
    const rightByte = right[index];
    if (leftByte === undefined || rightByte === undefined) {
      return false;
    }
    difference |= leftByte ^ rightByte;
  }
  return difference === 0;
}

export async function createPasswordDigest(password: string): Promise<PasswordDigest> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);

  return Object.freeze({
    algorithm: "PBKDF2-SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64Url(salt),
    hash: toBase64Url(hash)
  });
}

export async function verifyPassword(password: string, digest: PasswordDigest): Promise<boolean> {
  if (digest.algorithm !== "PBKDF2-SHA-256" || digest.iterations < 100_000) {
    return false;
  }

  const salt = fromBase64Url(digest.salt);
  const expectedHash = fromBase64Url(digest.hash);
  if (salt === null || expectedHash === null) {
    return false;
  }

  const actualHash = await derive(password, salt, digest.iterations);
  return constantTimeEqual(actualHash, expectedHash);
}

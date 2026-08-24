const AES_GCM_IV_BYTES = 12;
const AES_256_KEY_BYTES = 32;

export type EncryptedCredentialPayload = Readonly<{
  ciphertext: string;
  keyVersion: number;
}>;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    return null;
  }
  try {
    const padded = value
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function additionalData(
  provider: "salla" | "zid",
  connectionId: string,
  keyVersion: number
): Uint8Array {
  return new TextEncoder().encode(`hala:credential:${provider}:${connectionId}:v${keyVersion}`);
}

async function importEncryptionKey(rawKey: string): Promise<CryptoKey> {
  const keyBytes = base64UrlDecode(rawKey);
  if (keyBytes === null || keyBytes.byteLength !== AES_256_KEY_BYTES) {
    throw new Error("credential_encryption_key_invalid");
  }
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt"
  ]);
}

export async function encryptCredentialPayload(input: {
  plaintext: string;
  rawKey: string;
  keyVersion: number;
  provider: "salla" | "zid";
  connectionId: string;
}): Promise<EncryptedCredentialPayload> {
  if (!Number.isInteger(input.keyVersion) || input.keyVersion < 1) {
    throw new Error("credential_key_version_invalid");
  }
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const key = await importEncryptionKey(input.rawKey);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: additionalData(input.provider, input.connectionId, input.keyVersion),
      tagLength: 128
    },
    key,
    new TextEncoder().encode(input.plaintext)
  );
  const ciphertextBytes = new Uint8Array(encrypted);
  const envelope = new Uint8Array(iv.byteLength + ciphertextBytes.byteLength);
  envelope.set(iv);
  envelope.set(ciphertextBytes, iv.byteLength);
  return Object.freeze({ ciphertext: base64UrlEncode(envelope), keyVersion: input.keyVersion });
}

export async function decryptCredentialPayload(input: {
  ciphertext: string;
  rawKey: string;
  keyVersion: number;
  provider: "salla" | "zid";
  connectionId: string;
}): Promise<string | null> {
  if (!Number.isInteger(input.keyVersion) || input.keyVersion < 1) {
    return null;
  }
  const envelope = base64UrlDecode(input.ciphertext);
  if (envelope === null || envelope.byteLength <= AES_GCM_IV_BYTES) {
    return null;
  }
  try {
    const key = await importEncryptionKey(input.rawKey);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: envelope.slice(0, AES_GCM_IV_BYTES),
        additionalData: additionalData(input.provider, input.connectionId, input.keyVersion),
        tagLength: 128
      },
      key,
      envelope.slice(AES_GCM_IV_BYTES)
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

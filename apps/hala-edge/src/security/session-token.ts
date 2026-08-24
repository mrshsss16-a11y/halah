export type IssuedSessionToken = Readonly<{
  rawToken: string;
  tokenHash: string;
}>;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function issueSessionToken(): Promise<IssuedSessionToken> {
  const rawToken = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256Base64Url(rawToken);
  return Object.freeze({ rawToken, tokenHash });
}

export async function hashSessionToken(rawToken: string): Promise<string> {
  return sha256Base64Url(rawToken);
}

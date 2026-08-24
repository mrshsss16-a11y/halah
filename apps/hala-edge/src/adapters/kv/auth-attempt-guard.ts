import type {
  AuthAttemptGuardPort,
  AuthAttemptOutcome,
  ConsumeAuthAttemptInput
} from "../../modules/identity/auth-attempt-guard";

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS_PER_WINDOW = 5;

type StoredAuthAttempt = Readonly<{
  count: number;
}>;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function hashKeyPart(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function parseStoredAttempt(value: string | null): StoredAuthAttempt {
  if (value === null) {
    return Object.freeze({ count: 0 });
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "count" in parsed &&
      typeof parsed.count === "number" &&
      Number.isInteger(parsed.count) &&
      parsed.count >= 0 &&
      parsed.count <= MAX_ATTEMPTS_PER_WINDOW
    ) {
      return Object.freeze({ count: parsed.count });
    }
  } catch {
    return Object.freeze({ count: 0 });
  }

  return Object.freeze({ count: 0 });
}

export class KvAuthAttemptGuard implements AuthAttemptGuardPort {
  public constructor(private readonly namespace: KVNamespace) {}

  public async consume(input: ConsumeAuthAttemptInput): Promise<AuthAttemptOutcome> {
    try {
      const [emailHash, addressHash] = await Promise.all([
        hashKeyPart(input.email),
        hashKeyPart(input.clientAddress)
      ]);
      const key = `hala:auth-attempt:v1:${input.operation}:${emailHash}:${addressHash}`;
      const current = parseStoredAttempt(await this.namespace.get(key));
      if (current.count >= MAX_ATTEMPTS_PER_WINDOW) {
        return Object.freeze({ kind: "limited", retryAfterSeconds: WINDOW_SECONDS });
      }

      await this.namespace.put(key, JSON.stringify({ count: current.count + 1 }), {
        expirationTtl: WINDOW_SECONDS
      });
      return Object.freeze({ kind: "allowed" });
    } catch {
      return Object.freeze({ kind: "unavailable" });
    }
  }
}

import type { ConsumeSallaOAuthStateOutcome, SallaOAuthStatePort } from "./salla-oauth-state-port";

const STATE_DURATION_MS = 1000 * 60 * 10;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function hashState(rawState: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawState));
  return toBase64Url(new Uint8Array(digest));
}

function expiryIso(now: Date): string {
  return new Date(now.getTime() + STATE_DURATION_MS).toISOString();
}

export type CreateSallaOAuthStateOutcome = Readonly<{
  kind: "created";
  rawState: string;
  expiresAt: string;
}>;

export class SallaOAuthStateService {
  public constructor(
    private readonly port: SallaOAuthStatePort,
    private readonly clock: () => Date = () => new Date()
  ) {}

  public async create(
    input: Readonly<{ organizationId: string }>
  ): Promise<CreateSallaOAuthStateOutcome> {
    const now = this.clock();
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const rawState = toBase64Url(bytes);
    const expiresAt = expiryIso(now);

    await this.port.create({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      stateHash: await hashState(rawState),
      expiresAt,
      createdAt: now.toISOString()
    });

    return { kind: "created", rawState, expiresAt };
  }

  public async consume(rawState: string): Promise<ConsumeSallaOAuthStateOutcome> {
    const normalizedState = rawState.trim();
    if (normalizedState.length === 0) {
      return { kind: "missing_or_expired" };
    }

    return this.port.consume({
      stateHash: await hashState(normalizedState),
      now: this.clock().toISOString()
    });
  }
}

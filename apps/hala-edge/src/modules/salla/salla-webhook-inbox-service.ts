import type { SallaWebhookInboxPort } from "./salla-webhook-inbox-port";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function hashPayload(rawBody: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", rawBody);
  return toBase64Url(new Uint8Array(digest));
}

export type ReceiveSallaWebhookInput = Readonly<{
  organizationId: string;
  externalEventId: string;
  eventType: string;
  rawBody: Uint8Array;
  requestId: string;
}>;

export type ReceiveSallaWebhookOutcome =
  | Readonly<{ kind: "recorded"; inboxEventId: string }>
  | Readonly<{ kind: "duplicate" }>
  | Readonly<{ kind: "idempotency_conflict" }>
  | Readonly<{ kind: "invalid_envelope" }>;

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

export class SallaWebhookInboxService {
  public constructor(
    private readonly port: SallaWebhookInboxPort,
    private readonly clock: () => Date = () => new Date()
  ) {}

  public async receive(input: ReceiveSallaWebhookInput): Promise<ReceiveSallaWebhookOutcome> {
    if (
      !hasText(input.organizationId) ||
      !hasText(input.externalEventId) ||
      !hasText(input.eventType) ||
      !hasText(input.requestId) ||
      input.rawBody.byteLength === 0
    ) {
      return { kind: "invalid_envelope" };
    }

    return this.port.record({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      externalEventId: input.externalEventId.trim(),
      eventType: input.eventType.trim(),
      payloadHash: await hashPayload(input.rawBody),
      receivedAt: this.clock().toISOString(),
      requestId: input.requestId.trim()
    });
  }
}

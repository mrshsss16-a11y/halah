import { describe, expect, it } from "vitest";
import type {
  RecordSallaWebhookInboxOutcome,
  SallaWebhookInboxPort,
  SallaWebhookInboxRecord
} from "../../src/modules/salla/salla-webhook-inbox-port";
import { SallaWebhookInboxService } from "../../src/modules/salla/salla-webhook-inbox-service";

class FakeSallaWebhookInboxPort implements SallaWebhookInboxPort {
  public records: SallaWebhookInboxRecord[] = [];
  public outcome: RecordSallaWebhookInboxOutcome = { kind: "recorded", inboxEventId: "inbox-1" };

  public async record(input: SallaWebhookInboxRecord): Promise<RecordSallaWebhookInboxOutcome> {
    this.records.push(input);
    return this.outcome;
  }
}

describe("Salla webhook inbox service", () => {
  it("hashes the raw body and records only the required event metadata", async () => {
    const port = new FakeSallaWebhookInboxPort();
    const service = new SallaWebhookInboxService(port, () => new Date("2026-08-24T12:00:00.000Z"));
    const rawBody = new TextEncoder().encode(
      '{"event":"abandoned.cart","email":"customer@example.test"}'
    );

    await expect(
      service.receive({
        organizationId: "org-a",
        externalEventId: "event-a",
        eventType: "abandoned.cart",
        rawBody,
        requestId: "request-a"
      })
    ).resolves.toEqual({ kind: "recorded", inboxEventId: "inbox-1" });

    expect(port.records).toHaveLength(1);
    expect(port.records[0]).toMatchObject({
      organizationId: "org-a",
      externalEventId: "event-a",
      eventType: "abandoned.cart",
      requestId: "request-a",
      receivedAt: "2026-08-24T12:00:00.000Z"
    });
    expect(port.records[0]?.payloadHash).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(port.records[0]?.payloadHash).not.toContain("customer@example.test");
  });

  it("does not persist an empty or incomplete event envelope", async () => {
    const port = new FakeSallaWebhookInboxPort();
    const service = new SallaWebhookInboxService(port);

    await expect(
      service.receive({
        organizationId: "org-a",
        externalEventId: "",
        eventType: "abandoned.cart",
        rawBody: new Uint8Array(),
        requestId: "request-a"
      })
    ).resolves.toEqual({ kind: "invalid_envelope" });
    expect(port.records).toHaveLength(0);
  });

  it("preserves duplicate outcomes so the HTTP layer can acknowledge retries safely", async () => {
    const port = new FakeSallaWebhookInboxPort();
    port.outcome = { kind: "duplicate" };
    const service = new SallaWebhookInboxService(port);

    await expect(
      service.receive({
        organizationId: "org-a",
        externalEventId: "event-a",
        eventType: "abandoned.cart",
        rawBody: new TextEncoder().encode("{}"),
        requestId: "request-a"
      })
    ).resolves.toEqual({ kind: "duplicate" });
  });
});

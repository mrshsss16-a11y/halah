import type {
  RecordSallaWebhookInboxOutcome,
  SallaWebhookInboxPort,
  SallaWebhookInboxRecord
} from "../../modules/salla/salla-webhook-inbox-port";

function readText(row: Record<string, unknown> | null, key: string): string | null {
  const value = row?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export class D1SallaWebhookInboxRepository implements SallaWebhookInboxPort {
  public constructor(private readonly database: D1Database) {}

  public async record(input: SallaWebhookInboxRecord): Promise<RecordSallaWebhookInboxOutcome> {
    const insert = await this.database
      .prepare(
        "INSERT INTO salla_webhook_inbox (id, organization_id, external_event_id, event_type, payload_hash, request_id, received_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT (organization_id, external_event_id) DO NOTHING"
      )
      .bind(
        input.id,
        input.organizationId,
        input.externalEventId,
        input.eventType,
        input.payloadHash,
        input.requestId,
        input.receivedAt
      )
      .run();

    if (insert.meta.changes === 1) {
      return { kind: "recorded", inboxEventId: input.id };
    }

    const existing = await this.database
      .prepare(
        "SELECT event_type, payload_hash FROM salla_webhook_inbox WHERE organization_id = ?1 AND external_event_id = ?2 LIMIT 1"
      )
      .bind(input.organizationId, input.externalEventId)
      .first<Record<string, unknown>>();
    const eventType = readText(existing, "event_type");
    const payloadHash = readText(existing, "payload_hash");

    if (eventType === input.eventType && payloadHash === input.payloadHash) {
      return { kind: "duplicate" };
    }

    return { kind: "idempotency_conflict" };
  }
}

export type SallaWebhookInboxRecord = Readonly<{
  id: string;
  organizationId: string;
  externalEventId: string;
  eventType: string;
  payloadHash: string;
  receivedAt: string;
  requestId: string;
}>;

export type RecordSallaWebhookInboxOutcome =
  | Readonly<{ kind: "recorded"; inboxEventId: string }>
  | Readonly<{ kind: "duplicate" }>
  | Readonly<{ kind: "idempotency_conflict" }>;

export interface SallaWebhookInboxPort {
  record(input: SallaWebhookInboxRecord): Promise<RecordSallaWebhookInboxOutcome>;
}

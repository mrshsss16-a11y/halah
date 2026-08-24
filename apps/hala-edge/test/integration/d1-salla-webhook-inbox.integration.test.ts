import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { D1SallaWebhookInboxRepository } from "../../src/adapters/d1/salla-webhook-inbox-repository";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

const organizationA = "11111111-1111-4111-8111-111111111111";
const organizationB = "22222222-2222-4222-8222-222222222222";
const now = "2026-08-24T12:00:00.000Z";

async function createWebhookInboxSchema(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL, display_name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    ),
    env.DB.prepare(
      "CREATE TABLE salla_webhook_inbox (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, external_event_id TEXT NOT NULL, event_type TEXT NOT NULL, payload_hash TEXT NOT NULL, request_id TEXT NOT NULL, received_at TEXT NOT NULL, UNIQUE (organization_id, external_event_id))"
    )
  ]);
}

async function seedOrganizations(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO organizations (id, display_name, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)"
    ).bind(organizationA, "منظمة أ", now),
    env.DB.prepare(
      "INSERT INTO organizations (id, display_name, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)"
    ).bind(organizationB, "منظمة ب", now)
  ]);
}

describe("D1 Salla webhook inbox repository", () => {
  beforeEach(async () => {
    await createWebhookInboxSchema();
    await seedOrganizations();
  });

  it("records an event once and classifies an identical retry as duplicate", async () => {
    const repository = new D1SallaWebhookInboxRepository(env.DB);
    const input = {
      id: "inbox-a",
      organizationId: organizationA,
      externalEventId: "event-1",
      eventType: "abandoned.cart",
      payloadHash: "payload-hash-a",
      requestId: "request-a",
      receivedAt: now
    };

    await expect(repository.record(input)).resolves.toEqual({
      kind: "recorded",
      inboxEventId: "inbox-a"
    });
    await expect(
      repository.record({ ...input, id: "inbox-b", requestId: "request-b" })
    ).resolves.toEqual({
      kind: "duplicate"
    });
  });

  it("rejects conflicting payloads while allowing the same external ID in another organization", async () => {
    const repository = new D1SallaWebhookInboxRepository(env.DB);
    await repository.record({
      id: "inbox-a",
      organizationId: organizationA,
      externalEventId: "event-1",
      eventType: "abandoned.cart",
      payloadHash: "payload-hash-a",
      requestId: "request-a",
      receivedAt: now
    });

    await expect(
      repository.record({
        id: "inbox-b",
        organizationId: organizationA,
        externalEventId: "event-1",
        eventType: "abandoned.cart",
        payloadHash: "payload-hash-b",
        requestId: "request-b",
        receivedAt: now
      })
    ).resolves.toEqual({ kind: "idempotency_conflict" });

    await expect(
      repository.record({
        id: "inbox-c",
        organizationId: organizationB,
        externalEventId: "event-1",
        eventType: "abandoned.cart",
        payloadHash: "payload-hash-c",
        requestId: "request-c",
        receivedAt: now
      })
    ).resolves.toEqual({ kind: "recorded", inboxEventId: "inbox-c" });
  });
});

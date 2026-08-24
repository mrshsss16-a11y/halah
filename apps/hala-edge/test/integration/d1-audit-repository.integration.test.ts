import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { AuditRepository } from "../../src/adapters/d1/audit-repository";

const organizationA = "11111111-1111-4111-8111-111111111111";
const organizationB = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

async function createAuditSchema(): Promise<void> {
  await env.DB.prepare(
    "CREATE TABLE audit_events (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, actor_user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, request_id TEXT NOT NULL, reason_code TEXT, created_at TEXT NOT NULL)"
  ).run();
}

async function seedAuditEvents(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, reason_code, created_at) VALUES ('44444444-4444-4444-8444-444444444444', ?1, NULL, 'product_fact_evidence_approved', 'product_fact_set', 'fact-1', ?2, 'manual_evidence_review', '2026-08-24T00:03:00.000Z')"
    ).bind(organizationA, requestId),
    env.DB.prepare(
      "INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, reason_code, created_at) VALUES ('55555555-5555-4555-8555-555555555555', ?1, NULL, 'product_content_draft_rejected', 'product_content_draft', 'draft-1', ?2, 'review_rejected', '2026-08-24T00:02:00.000Z')"
    ).bind(organizationA, requestId),
    env.DB.prepare(
      "INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, reason_code, created_at) VALUES ('66666666-6666-4666-8666-666666666666', ?1, NULL, 'product_fact_evidence_approved', 'product_fact_set', 'fact-2', ?2, 'manual_evidence_review', '2026-08-24T00:01:00.000Z')"
    ).bind(organizationA, requestId),
    env.DB.prepare(
      "INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, reason_code, created_at) VALUES ('77777777-7777-4777-8777-777777777777', ?1, NULL, 'product_fact_evidence_approved', 'product_fact_set', 'fact-hidden', ?2, 'manual_evidence_review', '2026-08-24T00:04:00.000Z')"
    ).bind(organizationB, requestId)
  ]);
}

describe("AuditRepository D1 listing", () => {
  beforeEach(async () => {
    await createAuditSchema();
    await seedAuditEvents();
  });

  it("returns paginated, action-filtered audit metadata for the requesting organization only", async () => {
    const repository = new AuditRepository(env.DB);

    await expect(
      repository.listOrganizationEvents(organizationA, {
        page: 1,
        pageSize: 5,
        action: "product_fact_evidence_approved"
      })
    ).resolves.toEqual({
      total: 2,
      items: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          action: "product_fact_evidence_approved",
          entityType: "product_fact_set",
          entityId: "fact-1",
          requestId,
          reasonCode: "manual_evidence_review",
          createdAt: "2026-08-24T00:03:00.000Z"
        },
        {
          id: "66666666-6666-4666-8666-666666666666",
          action: "product_fact_evidence_approved",
          entityType: "product_fact_set",
          entityId: "fact-2",
          requestId,
          reasonCode: "manual_evidence_review",
          createdAt: "2026-08-24T00:01:00.000Z"
        }
      ]
    });
    await expect(
      repository.listOrganizationEvents(organizationA, { page: 2, pageSize: 2 })
    ).resolves.toMatchObject({
      total: 3,
      items: [{ id: "66666666-6666-4666-8666-666666666666" }]
    });
  });
});

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ProductContentRepository } from "../../src/adapters/d1/product-content-repository";

const organizationA = "11111111-1111-4111-8111-111111111111";
const organizationB = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const approvedFactId = "44444444-4444-4444-8444-444444444444";
const now = "2026-08-24T00:00:00.000Z";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

async function createDraftSchema(): Promise<void> {
  const statements = [
    "CREATE TABLE product_fact_sets (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, facts_json TEXT NOT NULL, evidence_status TEXT NOT NULL)",
    "CREATE TABLE product_content_drafts (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, product_fact_set_id TEXT NOT NULL, title TEXT NOT NULL, short_description TEXT NOT NULL, long_description TEXT NOT NULL, meta_description TEXT NOT NULL, evidence_map_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE audit_events (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, actor_user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, request_id TEXT NOT NULL, reason_code TEXT, created_at TEXT NOT NULL)"
  ];
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
}

async function seedFacts(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO product_fact_sets (id, organization_id, facts_json, evidence_status) VALUES (?1, ?2, ?3, 'approved')"
    ).bind(approvedFactId, organizationA, JSON.stringify({ productNameAr: "عباية سوداء" })),
    env.DB.prepare(
      "INSERT INTO product_fact_sets (id, organization_id, facts_json, evidence_status) VALUES (?1, ?2, ?3, 'needs_evidence')"
    ).bind("55555555-5555-4555-8555-555555555555", organizationA, "{}"),
    env.DB.prepare(
      "INSERT INTO product_fact_sets (id, organization_id, facts_json, evidence_status) VALUES (?1, ?2, ?3, 'approved')"
    ).bind("66666666-6666-4666-8666-666666666666", organizationB, "{}")
  ]);
}

describe("ProductContentRepository D1 draft isolation", () => {
  beforeEach(async () => {
    await createDraftSchema();
    await seedFacts();
  });

  it("returns only an approved fact belonging to the requested organization", async () => {
    const repository = new ProductContentRepository(env.DB);

    await expect(repository.findApprovedFact(organizationA, approvedFactId)).resolves.toEqual({
      id: approvedFactId,
      factsJson: JSON.stringify({ productNameAr: "عباية سوداء" })
    });
    await expect(
      repository.findApprovedFact(organizationA, "66666666-6666-4666-8666-666666666666")
    ).resolves.toBeNull();
    await expect(
      repository.findApprovedFact(organizationA, "55555555-5555-4555-8555-555555555555")
    ).resolves.toBeNull();
  });

  it("writes a draft and its audit event in the same organization scope", async () => {
    const repository = new ProductContentRepository(env.DB);
    await repository.createDraft({
      id: "77777777-7777-4777-8777-777777777777",
      organizationId: organizationA,
      productFactSetId: approvedFactId,
      title: "عباية سوداء",
      shortDescription: "وصف قصير موثق.",
      longDescription: "وصف طويل موثق يحتاج مراجعة قبل أي معاينة أو تصدير.",
      metaDescription: "وصف ميتا موثق للمراجعة فقط.",
      evidenceMapJson: JSON.stringify({ version: 1, evidence: [] }),
      status: "ready_for_review",
      createdAt: now,
      auditEventId: "88888888-8888-4888-8888-888888888888",
      createdByUserId: userId,
      requestId: "request-1"
    });

    const draft = await env.DB.prepare(
      "SELECT organization_id, status FROM product_content_drafts WHERE id = ?1"
    )
      .bind("77777777-7777-4777-8777-777777777777")
      .first<Record<string, unknown>>();
    const audit = await env.DB.prepare(
      "SELECT organization_id, action FROM audit_events WHERE entity_id = ?1"
    )
      .bind("77777777-7777-4777-8777-777777777777")
      .first<Record<string, unknown>>();

    expect(draft).toEqual({ organization_id: organizationA, status: "ready_for_review" });
    expect(audit).toEqual({
      organization_id: organizationA,
      action: "product_content_draft_created"
    });
  });
});

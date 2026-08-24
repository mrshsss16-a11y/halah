import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ProductContentRepository } from "../../src/adapters/d1/product-content-repository";

const organizationA = "11111111-1111-4111-8111-111111111111";
const organizationB = "22222222-2222-4222-8222-222222222222";
const userA = "33333333-3333-4333-8333-333333333333";
const draftA = "44444444-4444-4444-8444-444444444444";
const draftB = "55555555-5555-4555-8555-555555555555";
const now = "2026-08-24T00:00:00.000Z";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

async function createReviewSchema(): Promise<void> {
  const statements = [
    "CREATE TABLE product_fact_sets (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, sku TEXT NOT NULL, product_reference TEXT NOT NULL)",
    "CREATE TABLE product_content_drafts (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, product_fact_set_id TEXT NOT NULL, title TEXT NOT NULL, short_description TEXT NOT NULL, long_description TEXT NOT NULL, meta_description TEXT NOT NULL, evidence_map_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, reviewed_by_user_id TEXT, reviewed_at TEXT, review_note TEXT)",
    "CREATE TABLE audit_events (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, actor_user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, request_id TEXT NOT NULL, reason_code TEXT, created_at TEXT NOT NULL)"
  ];
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
}

async function seedDrafts(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO product_fact_sets (id, organization_id, sku, product_reference) VALUES ('fact-a', ?1, 'SKU-A', 'product-a')"
    ).bind(organizationA),
    env.DB.prepare(
      "INSERT INTO product_fact_sets (id, organization_id, sku, product_reference) VALUES ('fact-b', ?1, 'SKU-B', 'product-b')"
    ).bind(organizationB),
    env.DB.prepare(
      "INSERT INTO product_content_drafts (id, organization_id, product_fact_set_id, title, short_description, long_description, meta_description, evidence_map_json, status, created_at, updated_at) VALUES (?1, ?2, 'fact-a', 'مسودة أ', 'وصف قصير أ', 'وصف كامل أ', 'وصف ميتا أ', '{}', 'ready_for_review', ?3, ?3)"
    ).bind(draftA, organizationA, now),
    env.DB.prepare(
      "INSERT INTO product_content_drafts (id, organization_id, product_fact_set_id, title, short_description, long_description, meta_description, evidence_map_json, status, created_at, updated_at) VALUES (?1, ?2, 'fact-b', 'مسودة ب', 'وصف قصير ب', 'وصف كامل ب', 'وصف ميتا ب', '{}', 'ready_for_review', ?3, ?3)"
    ).bind(draftB, organizationB, now)
  ]);
}

describe("ProductContentRepository D1 draft review", () => {
  beforeEach(async () => {
    await createReviewSchema();
    await seedDrafts();
  });

  it("lists only ready drafts belonging to the requesting organization", async () => {
    const repository = new ProductContentRepository(env.DB);

    await expect(repository.listDraftReviewItems(organizationA)).resolves.toEqual([
      {
        id: draftA,
        productFactSetId: "fact-a",
        title: "مسودة أ",
        shortDescription: "وصف قصير أ",
        longDescription: "وصف كامل أ",
        metaDescription: "وصف ميتا أ",
        evidenceMapJson: "{}"
      }
    ]);
  });

  it("approves one organization draft without touching another organization draft", async () => {
    const repository = new ProductContentRepository(env.DB);

    await expect(
      repository.reviewDraft({
        draftId: draftA,
        organizationId: organizationA,
        userId: userA,
        decision: "approve",
        reviewNote: "مراجعة تركيبية",
        reviewedAt: now,
        auditEventId: "66666666-6666-4666-8666-666666666666",
        requestId: "request-1"
      })
    ).resolves.toBe(true);
    await expect(
      repository.reviewDraft({
        draftId: draftB,
        organizationId: organizationA,
        userId: userA,
        decision: "reject",
        reviewNote: "لا ينتمي للمساحة",
        reviewedAt: now,
        auditEventId: "77777777-7777-4777-8777-777777777777",
        requestId: "request-2"
      })
    ).resolves.toBe(false);

    await expect(repository.listPreviewItems(organizationA)).resolves.toEqual([
      {
        id: draftA,
        sku: "SKU-A",
        productReference: "product-a",
        title: "مسودة أ",
        shortDescription: "وصف قصير أ",
        longDescription: "وصف كامل أ",
        metaDescription: "وصف ميتا أ",
        evidenceMapJson: "{}"
      }
    ]);
    await expect(repository.listPreviewItems(organizationB)).resolves.toEqual([]);

    const rows = await env.DB.prepare(
      "SELECT organization_id, status, review_note FROM product_content_drafts ORDER BY id ASC"
    ).all<Record<string, unknown>>();
    const audit = await env.DB.prepare(
      "SELECT action, organization_id FROM audit_events WHERE entity_id = ?1"
    )
      .bind(draftA)
      .first<Record<string, unknown>>();

    expect(rows.results).toEqual([
      {
        organization_id: organizationA,
        status: "approved_for_preview",
        review_note: "مراجعة تركيبية"
      },
      { organization_id: organizationB, status: "ready_for_review", review_note: null }
    ]);
    expect(audit).toEqual({
      action: "product_content_draft_approved_for_preview",
      organization_id: organizationA
    });
  });
});

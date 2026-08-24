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

async function createExportStageSchema(): Promise<void> {
  const statements = [
    "CREATE TABLE product_fact_sets (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, sku TEXT NOT NULL, product_reference TEXT NOT NULL)",
    "CREATE TABLE product_content_drafts (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, product_fact_set_id TEXT NOT NULL, title TEXT NOT NULL, short_description TEXT NOT NULL, long_description TEXT NOT NULL, meta_description TEXT NOT NULL, evidence_map_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE product_content_export_stages (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, format TEXT NOT NULL, status TEXT NOT NULL, item_count INTEGER NOT NULL, created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL)",
    "CREATE TABLE product_content_export_stage_items (export_stage_id TEXT NOT NULL, organization_id TEXT NOT NULL, draft_id TEXT NOT NULL, sku TEXT NOT NULL, product_reference TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (export_stage_id, draft_id))",
    "CREATE TABLE audit_events (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, actor_user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, request_id TEXT NOT NULL, reason_code TEXT, created_at TEXT NOT NULL)"
  ];
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
}

async function seedApprovedDrafts(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO product_fact_sets (id, organization_id, sku, product_reference) VALUES ('fact-a', ?1, 'SKU-A', 'product-a')"
    ).bind(organizationA),
    env.DB.prepare(
      "INSERT INTO product_fact_sets (id, organization_id, sku, product_reference) VALUES ('fact-b', ?1, 'SKU-B', 'product-b')"
    ).bind(organizationB),
    env.DB.prepare(
      "INSERT INTO product_content_drafts (id, organization_id, product_fact_set_id, title, short_description, long_description, meta_description, evidence_map_json, status, created_at, updated_at) VALUES (?1, ?2, 'fact-a', 'عباية أ', 'وصف قصير أ', 'وصف كامل أ', 'وصف ميتا أ', '{\"version\":1}', 'approved_for_preview', ?3, ?3)"
    ).bind(draftA, organizationA, now),
    env.DB.prepare(
      "INSERT INTO product_content_drafts (id, organization_id, product_fact_set_id, title, short_description, long_description, meta_description, evidence_map_json, status, created_at, updated_at) VALUES (?1, ?2, 'fact-b', 'عطر ب', 'وصف قصير ب', 'وصف كامل ب', 'وصف ميتا ب', '{\"version\":1}', 'approved_for_preview', ?3, ?3)"
    ).bind(draftB, organizationB, now)
  ]);
}

describe("ProductContentRepository D1 export staging", () => {
  beforeEach(async () => {
    await createExportStageSchema();
    await seedApprovedDrafts();
  });

  it("stages an immutable local snapshot and audit for approved drafts in the same organization", async () => {
    const repository = new ProductContentRepository(env.DB);

    await expect(
      repository.createExportStage({
        exportStageId: "66666666-6666-4666-8666-666666666666",
        auditEventId: "77777777-7777-4777-8777-777777777777",
        organizationId: organizationA,
        userId: userA,
        requestId: "request-1",
        draftIds: [draftA],
        createdAt: now
      })
    ).resolves.toEqual({ kind: "staged", itemCount: 1 });

    const stage = await env.DB.prepare(
      "SELECT organization_id, format, status, item_count FROM product_content_export_stages"
    ).first<Record<string, unknown>>();
    const item = await env.DB.prepare(
      "SELECT organization_id, draft_id, sku, product_reference, snapshot_json FROM product_content_export_stage_items"
    ).first<Record<string, unknown>>();
    const audit = await env.DB.prepare(
      "SELECT organization_id, action, reason_code FROM audit_events WHERE entity_id = ?1"
    )
      .bind("66666666-6666-4666-8666-666666666666")
      .first<Record<string, unknown>>();

    expect(stage).toEqual({
      organization_id: organizationA,
      format: "csv_review",
      status: "staged",
      item_count: 1
    });
    expect(item).toEqual({
      organization_id: organizationA,
      draft_id: draftA,
      sku: "SKU-A",
      product_reference: "product-a",
      snapshot_json:
        '{"version":1,"draftId":"44444444-4444-4444-8444-444444444444","sku":"SKU-A","productReference":"product-a","title":"عباية أ","shortDescription":"وصف قصير أ","longDescription":"وصف كامل أ","metaDescription":"وصف ميتا أ","evidenceMapJson":"{\\"version\\":1}"}'
    });
    expect(audit).toEqual({
      organization_id: organizationA,
      action: "product_content_export_staged",
      reason_code: "csv_review_local_only"
    });
  });

  it("refuses a cross-organization draft and leaves no stage or audit", async () => {
    const repository = new ProductContentRepository(env.DB);

    await expect(
      repository.createExportStage({
        exportStageId: "66666666-6666-4666-8666-666666666666",
        auditEventId: "77777777-7777-4777-8777-777777777777",
        organizationId: organizationA,
        userId: userA,
        requestId: "request-2",
        draftIds: [draftA, draftB],
        createdAt: now
      })
    ).resolves.toEqual({ kind: "drafts_not_available" });

    const stageCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM product_content_export_stages"
    ).first<Record<string, unknown>>();
    const auditCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_events").first<
      Record<string, unknown>
    >();
    expect(stageCount).toEqual({ count: 0 });
    expect(auditCount).toEqual({ count: 0 });
  });
});

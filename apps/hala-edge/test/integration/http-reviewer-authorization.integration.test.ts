import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/http/app";
import { hashSessionToken } from "../../src/security/session-token";
import type { HalaBindings } from "../../src/http/types";

const organizationId = "11111111-1111-4111-8111-111111111111";
const reviewerUserId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const factId = "44444444-4444-4444-8444-444444444444";
const draftId = "55555555-5555-4555-8555-555555555555";
const localSessionToken = "reviewer-local-session-token";
const now = "2026-08-24T00:00:00.000Z";
const expiry = "2026-09-24T00:00:00.000Z";

const jsonRequestHeaders = {
  "content-type": "application/json",
  origin: "https://hala.test",
  cookie: `hala_session=${localSessionToken}; hala_csrf=reviewer-csrf-token`,
  "x-hala-csrf": "reviewer-csrf-token"
};

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

async function seedReviewerScenario(): Promise<void> {
  const sessionHash = await hashSessionToken(localSessionToken);
  const statements = [
    "CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, email_normalized TEXT NOT NULL UNIQUE, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL, display_name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE organization_members (organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner', 'operator', 'reviewer', 'viewer')), created_at TEXT NOT NULL, PRIMARY KEY (organization_id, user_id))",
    "CREATE TABLE user_sessions (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, organization_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, revoked_at TEXT, last_seen_at TEXT NOT NULL, created_at TEXT NOT NULL)",
    "CREATE TABLE product_content_imports (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, source_name TEXT NOT NULL, record_count INTEGER NOT NULL, status TEXT NOT NULL, created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE product_fact_sets (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, product_import_id TEXT NOT NULL, product_reference TEXT NOT NULL, sku TEXT NOT NULL, category TEXT NOT NULL, facts_json TEXT NOT NULL, evidence_status TEXT NOT NULL, evidence_reviewed_by_user_id TEXT, evidence_reviewed_at TEXT, evidence_review_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE product_content_drafts (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, product_fact_set_id TEXT NOT NULL, title TEXT NOT NULL, short_description TEXT NOT NULL, long_description TEXT NOT NULL, meta_description TEXT NOT NULL, evidence_map_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, reviewed_by_user_id TEXT, reviewed_at TEXT, review_note TEXT)",
    "CREATE TABLE audit_events (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, actor_user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, request_id TEXT NOT NULL, reason_code TEXT, created_at TEXT NOT NULL)"
  ];
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email_normalized, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)"
    ).bind(reviewerUserId, "reviewer@example.test", now),
    env.DB.prepare(
      "INSERT INTO organizations (id, display_name, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)"
    ).bind(organizationId, "منظمة المراجعة", now),
    env.DB.prepare(
      "INSERT INTO organization_members (organization_id, user_id, role, created_at) VALUES (?1, ?2, 'reviewer', ?3)"
    ).bind(organizationId, reviewerUserId, now),
    env.DB.prepare(
      "INSERT INTO user_sessions (id, user_id, organization_id, token_hash, expires_at, revoked_at, last_seen_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?6)"
    ).bind(sessionId, reviewerUserId, organizationId, sessionHash, expiry, now),
    env.DB.prepare(
      "INSERT INTO product_content_imports (id, organization_id, source_name, record_count, status, created_by_user_id, created_at, updated_at) VALUES ('import-1', ?1, 'synthetic.csv', 1, 'needs_evidence', ?2, ?3, ?3)"
    ).bind(organizationId, reviewerUserId, now),
    env.DB.prepare(
      "INSERT INTO product_fact_sets (id, organization_id, product_import_id, product_reference, sku, category, facts_json, evidence_status, created_at, updated_at) VALUES (?1, ?2, 'import-1', 'product-1', 'SKU-REVIEWER', 'إكسسوارات', '{\"productNameAr\":\"قطعة اختبار\"}', 'needs_evidence', ?3, ?3)"
    ).bind(factId, organizationId, now),
    env.DB.prepare(
      "INSERT INTO product_content_drafts (id, organization_id, product_fact_set_id, title, short_description, long_description, meta_description, evidence_map_json, status, created_at, updated_at) VALUES (?1, ?2, ?3, 'مسودة مراجعة', 'وصف قصير تركيبي', 'وصف كامل تركيبي للمراجعة المحلية فقط.', 'وصف ميتا تركيبي', '{}', 'ready_for_review', ?4, ?4)"
    ).bind(draftId, organizationId, factId, now)
  ]);
}

describe("reviewer HTTP authorization", () => {
  it("allows reviewer-only review actions and blocks content mutation, export staging, and local Salla connection", async () => {
    await seedReviewerScenario();
    const app = createApp();
    const bindings = env as unknown as HalaBindings;

    const evidenceResponse = await app.request(
      `https://hala.test/api/product-content/facts/${factId}/approve-evidence`,
      {
        method: "POST",
        headers: jsonRequestHeaders,
        body: JSON.stringify({ reviewNote: "دليل تركيبي مراجع" })
      },
      bindings
    );
    const draftReviewResponse = await app.request(
      `https://hala.test/api/product-content/drafts/${draftId}/review`,
      {
        method: "POST",
        headers: jsonRequestHeaders,
        body: JSON.stringify({ decision: "approve", reviewNote: "مراجعة تركيبية مكتملة" })
      },
      bindings
    );
    const importResponse = await app.request(
      "https://hala.test/api/product-content/imports",
      { method: "POST", headers: jsonRequestHeaders, body: JSON.stringify({}) },
      bindings
    );
    const exportResponse = await app.request(
      "https://hala.test/api/product-content/export-stages",
      { method: "POST", headers: jsonRequestHeaders, body: JSON.stringify({}) },
      bindings
    );
    const connectionResponse = await app.request(
      "https://hala.test/api/connections/salla/mock/start",
      { method: "POST", headers: jsonRequestHeaders },
      bindings
    );

    expect(evidenceResponse.status).toBe(200);
    await expect(evidenceResponse.json()).resolves.toEqual({ status: "approved" });
    expect(draftReviewResponse.status).toBe(200);
    await expect(draftReviewResponse.json()).resolves.toEqual({ status: "reviewed" });
    expect(importResponse.status).toBe(403);
    await expect(importResponse.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
    expect(exportResponse.status).toBe(403);
    await expect(exportResponse.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
    expect(connectionResponse.status).toBe(403);
    await expect(connectionResponse.json()).resolves.toMatchObject({
      error: { code: "insufficient_role" }
    });

    await expect(
      env.DB.prepare(
        "SELECT evidence_status, evidence_reviewed_by_user_id FROM product_fact_sets WHERE id = ?1"
      )
        .bind(factId)
        .first<Record<string, unknown>>()
    ).resolves.toEqual({
      evidence_status: "approved",
      evidence_reviewed_by_user_id: reviewerUserId
    });
    await expect(
      env.DB.prepare("SELECT status, reviewed_by_user_id FROM product_content_drafts WHERE id = ?1")
        .bind(draftId)
        .first<Record<string, unknown>>()
    ).resolves.toEqual({ status: "approved_for_preview", reviewed_by_user_id: reviewerUserId });
  });
});

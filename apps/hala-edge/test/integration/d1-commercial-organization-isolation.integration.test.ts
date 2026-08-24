import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { CommercialRepository } from "../../src/adapters/d1/commercial-repository";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

const organizationA = "11111111-1111-4111-8111-111111111111";
const organizationB = "22222222-2222-4222-8222-222222222222";
const userA = "33333333-3333-4333-8333-333333333333";
const userB = "44444444-4444-4444-8444-444444444444";
const now = "2026-08-24T00:00:00.000Z";

async function createCommercialSchema(): Promise<void> {
  const statements = [
    "CREATE TABLE store_connections (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL)",
    "CREATE TABLE product_content_imports (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)",
    "CREATE TABLE policy_sources (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE activation_requests (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, requested_by_user_id TEXT NOT NULL, requested_service TEXT NOT NULL, status TEXT NOT NULL, notes TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
  ];
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
}

async function seedOrganizationA(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO store_connections (id, organization_id, provider, status) VALUES (?1, ?2, 'salla', 'active')"
    ).bind("connection-a", organizationA),
    env.DB.prepare(
      "INSERT INTO product_content_imports (id, organization_id, status, created_at) VALUES (?1, ?2, 'ready_for_generation', ?3)"
    ).bind("import-a", organizationA, now),
    env.DB.prepare(
      "INSERT INTO policy_sources (id, organization_id, status, updated_at) VALUES (?1, ?2, 'active', ?3)"
    ).bind("policy-a", organizationA, now),
    env.DB.prepare(
      "INSERT INTO activation_requests (id, organization_id, requested_by_user_id, requested_service, status, notes, created_at, updated_at) VALUES (?1, ?2, ?3, 'both', 'approved', '', ?4, ?4)"
    ).bind("activation-a", organizationA, userA, now)
  ]);
}

describe("CommercialRepository D1 organization isolation", () => {
  beforeEach(async () => {
    await createCommercialSchema();
    await seedOrganizationA();
  });

  it("does not surface organization A dashboard state in organization B", async () => {
    const repository = new CommercialRepository(env.DB);

    await expect(
      repository.loadDashboard({ organizationId: organizationB, organizationName: "منظمة ب" })
    ).resolves.toEqual({
      organizationName: "منظمة ب",
      connectionStatus: "not_connected",
      productContentStatus: "not_started",
      recoveryStatus: "not_configured",
      activationStatus: null
    });
  });

  it("stores and reads organization B activation without changing organization A", async () => {
    const repository = new CommercialRepository(env.DB);
    await repository.submitActivationRequest({
      id: "activation-b",
      organizationId: organizationB,
      userId: userB,
      requestedService: "product_content",
      notes: "طلب تركيبي",
      createdAt: now
    });

    await expect(
      repository.loadDashboard({ organizationId: organizationA, organizationName: "منظمة أ" })
    ).resolves.toMatchObject({ activationStatus: "approved" });
    await expect(
      repository.loadDashboard({ organizationId: organizationB, organizationName: "منظمة ب" })
    ).resolves.toMatchObject({ activationStatus: "submitted" });
  });
});

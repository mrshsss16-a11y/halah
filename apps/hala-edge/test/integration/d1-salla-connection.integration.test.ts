import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { D1SallaConnectionRepository } from "../../src/adapters/d1/salla-connection-repository";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

const organizationA = "11111111-1111-4111-8111-111111111111";
const organizationB = "22222222-2222-4222-8222-222222222222";
const now = "2026-08-24T12:00:00.000Z";

async function createConnectionSchema(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL, display_name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    ),
    env.DB.prepare(
      "CREATE TABLE store_connections (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, credential_key_version INTEGER NOT NULL, external_store_id TEXT, authorization_scope TEXT, authorization_expires_at TEXT, connected_at TEXT, last_webhook_received_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (organization_id, provider))"
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

describe("D1 Salla connection repository", () => {
  beforeEach(async () => {
    await createConnectionSchema();
    await seedOrganizations();
  });

  it("creates an authorizing connection then activates only that organization's row", async () => {
    const repository = new D1SallaConnectionRepository(env.DB);

    await repository.markAuthorizing({ organizationId: organizationA, updatedAt: now });
    await expect(
      repository.activateLocalMock({
        organizationId: organizationA,
        externalStoreId: "local-salla-org-a",
        authorizationScope: "local:mock",
        connectedAt: now
      })
    ).resolves.toBe(true);

    const row = await env.DB.prepare(
      "SELECT status, external_store_id, authorization_scope, connected_at FROM store_connections WHERE organization_id = ?1 AND provider = 'salla'"
    )
      .bind(organizationA)
      .first<Record<string, unknown>>();
    expect(row).toEqual({
      status: "active",
      external_store_id: "local-salla-org-a",
      authorization_scope: "local:mock",
      connected_at: now
    });
  });

  it("does not activate a missing connection for another organization", async () => {
    const repository = new D1SallaConnectionRepository(env.DB);
    await repository.markAuthorizing({ organizationId: organizationA, updatedAt: now });

    await expect(
      repository.activateLocalMock({
        organizationId: organizationB,
        externalStoreId: "local-salla-org-b",
        authorizationScope: "local:mock",
        connectedAt: now
      })
    ).resolves.toBe(false);
  });
});

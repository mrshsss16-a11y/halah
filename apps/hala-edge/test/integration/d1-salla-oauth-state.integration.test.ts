import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { D1SallaOAuthStateRepository } from "../../src/adapters/d1/salla-oauth-state-repository";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

const organizationA = "11111111-1111-4111-8111-111111111111";
const organizationB = "22222222-2222-4222-8222-222222222222";
const now = "2026-08-24T00:00:00.000Z";

async function createOAuthStateSchema(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL, display_name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    ),
    env.DB.prepare(
      "CREATE TABLE salla_oauth_states (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, state_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT NOT NULL)"
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

describe("D1 Salla OAuth state repository", () => {
  beforeEach(async () => {
    await createOAuthStateSchema();
    await seedOrganizations();
  });

  it("consumes a state once and returns only its scoped organization", async () => {
    const repository = new D1SallaOAuthStateRepository(env.DB);
    await repository.create({
      id: "state-a",
      organizationId: organizationA,
      stateHash: "hash-a",
      expiresAt: "2026-08-24T00:10:00.000Z",
      createdAt: now
    });

    await expect(repository.consume({ stateHash: "hash-a", now })).resolves.toEqual({
      kind: "accepted",
      organizationId: organizationA
    });
    await expect(repository.consume({ stateHash: "hash-a", now })).resolves.toEqual({
      kind: "already_consumed"
    });
  });

  it("rejects expired and unknown states without disclosing another organization", async () => {
    const repository = new D1SallaOAuthStateRepository(env.DB);
    await repository.create({
      id: "state-b",
      organizationId: organizationB,
      stateHash: "hash-b",
      expiresAt: "2026-08-23T23:59:59.000Z",
      createdAt: now
    });

    await expect(repository.consume({ stateHash: "hash-b", now })).resolves.toEqual({
      kind: "missing_or_expired"
    });
    await expect(repository.consume({ stateHash: "unknown", now })).resolves.toEqual({
      kind: "missing_or_expired"
    });
  });
});

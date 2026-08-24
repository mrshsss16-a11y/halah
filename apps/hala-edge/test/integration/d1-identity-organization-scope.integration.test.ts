import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { IdentityRepository } from "../../src/adapters/d1/identity-repository";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

const organizationA = "11111111-1111-4111-8111-111111111111";
const organizationB = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const sessionId = "44444444-4444-4444-8444-444444444444";
const tokenHash = "synthetic-session-hash";
const now = "2026-08-24T00:00:00.000Z";
const expiry = "2026-08-31T00:00:00.000Z";

async function createIdentitySchema(): Promise<void> {
  const statements = [
    "CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, email_normalized TEXT NOT NULL UNIQUE, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL, display_name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE organization_members (organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (organization_id, user_id))",
    "CREATE TABLE user_sessions (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, organization_id TEXT, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, revoked_at TEXT, last_seen_at TEXT NOT NULL, created_at TEXT NOT NULL)"
  ];
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
}

async function seedTwoOrganizationsWithScopedSession(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email_normalized, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)"
    ).bind(userId, "owner@example.test", now),
    env.DB.prepare(
      "INSERT INTO organizations (id, display_name, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)"
    ).bind(organizationA, "منظمة أ", now),
    env.DB.prepare(
      "INSERT INTO organizations (id, display_name, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)"
    ).bind(organizationB, "منظمة ب", now),
    env.DB.prepare(
      "INSERT INTO organization_members (organization_id, user_id, role, created_at) VALUES (?1, ?2, 'owner', ?3)"
    ).bind(organizationA, userId, "2026-08-20T00:00:00.000Z"),
    env.DB.prepare(
      "INSERT INTO organization_members (organization_id, user_id, role, created_at) VALUES (?1, ?2, 'operator', ?3)"
    ).bind(organizationB, userId, "2026-08-21T00:00:00.000Z"),
    env.DB.prepare(
      "INSERT INTO user_sessions (id, user_id, organization_id, token_hash, expires_at, revoked_at, last_seen_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?6)"
    ).bind(sessionId, userId, organizationB, tokenHash, expiry, now)
  ]);
}

describe("IdentityRepository D1 organization scope", () => {
  beforeEach(async () => {
    await createIdentitySchema();
    await seedTwoOrganizationsWithScopedSession();
  });

  it("resolves the organization stored on the session instead of the user's earliest membership", async () => {
    const repository = new IdentityRepository(env.DB);

    await expect(repository.findActiveSession(tokenHash, now)).resolves.toEqual({
      sessionId,
      userId,
      organizationId: organizationB,
      organizationName: "منظمة ب",
      role: "operator",
      expiresAt: expiry
    });
  });

  it("invalidates session lookup if the stored organization membership is removed", async () => {
    await env.DB.prepare(
      "DELETE FROM organization_members WHERE organization_id = ?1 AND user_id = ?2"
    )
      .bind(organizationB, userId)
      .run();
    const repository = new IdentityRepository(env.DB);

    await expect(repository.findActiveSession(tokenHash, now)).resolves.toBeNull();
  });
});

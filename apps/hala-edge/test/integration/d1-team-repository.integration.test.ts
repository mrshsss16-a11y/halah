import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { TeamRepository } from "../../src/adapters/d1/team-repository";

const organizationId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const memberId = "33333333-3333-4333-8333-333333333333";
const otherUserId = "44444444-4444-4444-8444-444444444444";
const requestId = "55555555-5555-4555-8555-555555555555";
const now = "2026-08-24T00:00:00.000Z";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

async function createSchema(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL, display_name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    ),
    env.DB.prepare(
      "CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, email_normalized TEXT NOT NULL UNIQUE, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    ),
    env.DB.prepare(
      "CREATE TABLE organization_members (organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (organization_id, user_id))"
    ),
    env.DB.prepare(
      "CREATE TABLE organization_team_invitations (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, email_normalized TEXT NOT NULL, role TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL, invited_by_user_id TEXT NOT NULL, expires_at TEXT NOT NULL, accepted_at TEXT, accepted_by_user_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    ),
    env.DB.prepare(
      "CREATE TABLE user_sessions (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, organization_id TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, last_seen_at TEXT NOT NULL, created_at TEXT NOT NULL)"
    ),
    env.DB.prepare(
      "CREATE TABLE audit_events (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, actor_user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, request_id TEXT NOT NULL, reason_code TEXT, created_at TEXT NOT NULL)"
    )
  ]);
}

async function seedUsersAndOwner(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO organizations (id, display_name, status, created_at, updated_at) VALUES (?1, 'منظمة اختبار', 'active', ?2, ?2)"
    ).bind(organizationId, now),
    env.DB.prepare(
      "INSERT INTO users (id, email_normalized, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)"
    ).bind(ownerId, "owner@example.test", now),
    env.DB.prepare(
      "INSERT INTO users (id, email_normalized, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)"
    ).bind(memberId, "member@example.test", now),
    env.DB.prepare(
      "INSERT INTO users (id, email_normalized, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)"
    ).bind(otherUserId, "other@example.test", now),
    env.DB.prepare(
      "INSERT INTO organization_members (organization_id, user_id, role, created_at) VALUES (?1, ?2, 'owner', ?3)"
    ).bind(organizationId, ownerId, now)
  ]);
}

describe("TeamRepository D1 lifecycle", () => {
  beforeEach(async () => {
    await createSchema();
    await seedUsersAndOwner();
  });

  it("stores invitation tokens as hashes and records safe invitation metadata", async () => {
    const repository = new TeamRepository(env.DB);
    const outcome = await repository.createTeamInvitation({
      invitationId: "66666666-6666-4666-8666-666666666666",
      organizationId,
      emailNormalized: "member@example.test",
      role: "reviewer",
      tokenHash: "synthetic-token-hash-only",
      invitedByUserId: ownerId,
      expiresAt: "2026-08-31T00:00:00.000Z",
      createdAt: now,
      requestId
    });

    expect(outcome).toEqual({ kind: "created" });
    await expect(
      env.DB.prepare(
        "SELECT email_normalized, role, status, token_hash FROM organization_team_invitations WHERE id = ?1"
      )
        .bind("66666666-6666-4666-8666-666666666666")
        .first<Record<string, unknown>>()
    ).resolves.toEqual({
      email_normalized: "member@example.test",
      role: "reviewer",
      status: "pending",
      token_hash: "synthetic-token-hash-only"
    });
    await expect(
      env.DB.prepare("SELECT action, reason_code FROM audit_events WHERE organization_id = ?1")
        .bind(organizationId)
        .first<Record<string, unknown>>()
    ).resolves.toEqual({ action: "team_invitation_created", reason_code: "reviewer" });
  });

  it("accepts a matching recipient once and creates organization membership", async () => {
    await env.DB.prepare(
      "INSERT INTO organization_team_invitations (id, organization_id, email_normalized, role, token_hash, status, invited_by_user_id, expires_at, accepted_at, accepted_by_user_id, created_at, updated_at) VALUES ('77777777-7777-4777-8777-777777777777', ?1, 'member@example.test', 'operator', 'hash-for-acceptance', 'pending', ?2, '2026-08-31T00:00:00.000Z', NULL, NULL, ?3, ?3)"
    )
      .bind(organizationId, ownerId, now)
      .run();
    const repository = new TeamRepository(env.DB);

    await expect(
      repository.acceptTeamInvitation({
        tokenHash: "hash-for-acceptance",
        userId: memberId,
        userEmailNormalized: "member@example.test",
        acceptedAt: now,
        requestId
      })
    ).resolves.toEqual({ kind: "accepted", organizationId });
    await expect(
      env.DB.prepare(
        "SELECT role FROM organization_members WHERE organization_id = ?1 AND user_id = ?2"
      )
        .bind(organizationId, memberId)
        .first<Record<string, unknown>>()
    ).resolves.toEqual({ role: "operator" });
    await expect(
      repository.acceptTeamInvitation({
        tokenHash: "hash-for-acceptance",
        userId: memberId,
        userEmailNormalized: "member@example.test",
        acceptedAt: now,
        requestId
      })
    ).resolves.toEqual({ kind: "already_accepted" });
  });

  it("protects the last owner and revokes scoped sessions when a non-owner is removed", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO organization_members (organization_id, user_id, role, created_at) VALUES (?1, ?2, 'viewer', ?3)"
      ).bind(organizationId, memberId, now),
      env.DB.prepare(
        "INSERT INTO user_sessions (id, user_id, organization_id, token_hash, expires_at, revoked_at, last_seen_at, created_at) VALUES ('88888888-8888-4888-8888-888888888888', ?1, ?2, 'member-session-hash', '2026-09-01T00:00:00.000Z', NULL, ?3, ?3)"
      ).bind(memberId, organizationId, now)
    ]);
    const repository = new TeamRepository(env.DB);

    await expect(
      repository.updateMemberRole({
        organizationId,
        userId: ownerId,
        role: "viewer",
        updatedByUserId: ownerId,
        updatedAt: now,
        requestId
      })
    ).resolves.toEqual({ kind: "last_owner_protected" });
    await expect(
      repository.removeMember({
        organizationId,
        userId: ownerId,
        removedByUserId: ownerId,
        removedAt: now,
        requestId
      })
    ).resolves.toEqual({ kind: "last_owner_protected" });
    await expect(
      repository.removeMember({
        organizationId,
        userId: memberId,
        removedByUserId: ownerId,
        removedAt: now,
        requestId
      })
    ).resolves.toEqual({ kind: "removed" });
    await expect(
      env.DB.prepare(
        "SELECT revoked_at FROM user_sessions WHERE id = '88888888-8888-4888-8888-888888888888'"
      ).first<Record<string, unknown>>()
    ).resolves.toEqual({ revoked_at: now });
  });
});

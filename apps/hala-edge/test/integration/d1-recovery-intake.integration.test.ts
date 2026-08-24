import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { D1RecoveryIntakeRepository } from "../../src/adapters/d1/recovery-intake-repository";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

const organizationA = "11111111-1111-4111-8111-111111111111";
const organizationB = "22222222-2222-4222-8222-222222222222";
const now = "2026-08-24T12:00:00.000Z";

async function createRecoverySchema(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL, display_name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    ),
    env.DB.prepare(
      "CREATE TABLE recovery_cases (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, external_cart_id TEXT NOT NULL, contact_hash TEXT NOT NULL, status TEXT NOT NULL, attempt_count INTEGER NOT NULL, policy_source_id TEXT, policy_version INTEGER, reason_code TEXT NOT NULL, next_action_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (organization_id, external_cart_id))"
    ),
    env.DB.prepare(
      "CREATE TABLE audit_events (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, actor_user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, request_id TEXT NOT NULL, reason_code TEXT, created_at TEXT NOT NULL)"
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

describe("D1 recovery intake repository", () => {
  beforeEach(async () => {
    await createRecoverySchema();
    await seedOrganizations();
  });

  it("records one received recovery case and one audit event for a cart", async () => {
    const repository = new D1RecoveryIntakeRepository(env.DB);
    const input = {
      id: "case-a",
      organizationId: organizationA,
      externalCartId: "cart-a",
      contactHash: "synthetic-contact-hash",
      requestId: "request-a",
      auditEventId: "audit-a",
      createdAt: now
    };

    await expect(repository.record(input)).resolves.toEqual({
      kind: "recorded",
      recoveryCaseId: "case-a"
    });
    await expect(
      repository.record({ ...input, id: "case-b", auditEventId: "audit-b" })
    ).resolves.toEqual({
      kind: "duplicate"
    });

    const caseRow = await env.DB.prepare(
      "SELECT status, attempt_count, reason_code FROM recovery_cases WHERE organization_id = ?1 AND external_cart_id = ?2"
    )
      .bind(organizationA, "cart-a")
      .first<Record<string, unknown>>();
    const auditCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_events WHERE organization_id = ?1 AND entity_type = 'recovery_case'"
    )
      .bind(organizationA)
      .first<Record<string, unknown>>();

    expect(caseRow).toEqual({ status: "received", attempt_count: 0, reason_code: "received" });
    expect(auditCount).toEqual({ count: 1 });
  });

  it("allows the same cart identifier in a separate organization", async () => {
    const repository = new D1RecoveryIntakeRepository(env.DB);

    await repository.record({
      id: "case-a",
      organizationId: organizationA,
      externalCartId: "cart-a",
      contactHash: "synthetic-contact-hash-a",
      requestId: "request-a",
      auditEventId: "audit-a",
      createdAt: now
    });

    await expect(
      repository.record({
        id: "case-b",
        organizationId: organizationB,
        externalCartId: "cart-a",
        contactHash: "synthetic-contact-hash-b",
        requestId: "request-b",
        auditEventId: "audit-b",
        createdAt: now
      })
    ).resolves.toEqual({ kind: "recorded", recoveryCaseId: "case-b" });
  });
});

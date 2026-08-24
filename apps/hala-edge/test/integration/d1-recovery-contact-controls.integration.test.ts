import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { RecoveryContactControlsRepository } from "../../src/adapters/d1/recovery-contact-controls-repository";
import { RecoveryContactControlsService } from "../../src/modules/recovery/recovery-contact-controls-service";

const organizationA = "11111111-1111-4111-8111-111111111111";
const organizationB = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const contactHash = "local-contact-hash-0000000000000001";
const now = "2026-08-24T00:00:00.000Z";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

async function createSchema(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE contact_consents (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, contact_hash TEXT NOT NULL, status TEXT NOT NULL, recorded_at TEXT NOT NULL, source_reference TEXT NOT NULL, UNIQUE (organization_id, contact_hash))"
    ),
    env.DB.prepare(
      "CREATE TABLE contact_suppressions (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, contact_hash TEXT NOT NULL, reason_code TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT, UNIQUE (organization_id, contact_hash))"
    ),
    env.DB.prepare(
      "CREATE TABLE audit_events (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, actor_user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, request_id TEXT NOT NULL, reason_code TEXT, created_at TEXT NOT NULL)"
    )
  ]);
}

describe("RecoveryContactControlsRepository D1", () => {
  beforeEach(async () => {
    await createSchema();
  });

  it("records consent and suppression by hash within one organization and audits both controls", async () => {
    const service = new RecoveryContactControlsService(
      new RecoveryContactControlsRepository(env.DB),
      () => new Date(now)
    );
    await service.updateConsent(organizationA, actorId, requestId, {
      contactHash,
      status: "granted",
      sourceReference: "local-policy-test"
    });
    await service.updateSuppression(organizationA, actorId, requestId, {
      contactHash,
      reasonCode: "customer_opt_out",
      expiresAt: null
    });
    await service.updateConsent(organizationB, actorId, requestId, {
      contactHash,
      status: "withdrawn",
      sourceReference: "other-organization"
    });

    await expect(
      env.DB.prepare(
        "SELECT status, source_reference FROM contact_consents WHERE organization_id = ?1 AND contact_hash = ?2"
      )
        .bind(organizationA, contactHash)
        .first<Record<string, unknown>>()
    ).resolves.toEqual({ status: "granted", source_reference: "local-policy-test" });
    await expect(
      env.DB.prepare(
        "SELECT reason_code FROM contact_suppressions WHERE organization_id = ?1 AND contact_hash = ?2"
      )
        .bind(organizationB, contactHash)
        .first()
    ).resolves.toBeNull();
    await expect(
      env.DB.prepare("SELECT COUNT(*) AS total FROM audit_events WHERE organization_id = ?1")
        .bind(organizationA)
        .first<Record<string, unknown>>()
    ).resolves.toEqual({ total: 2 });
    await expect(
      service.removeSuppression(organizationA, actorId, requestId, contactHash)
    ).resolves.toBe("removed");
    await expect(
      service.removeSuppression(organizationA, actorId, requestId, contactHash)
    ).resolves.toBe("missing");
  });
});

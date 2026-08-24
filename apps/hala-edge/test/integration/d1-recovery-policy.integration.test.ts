import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { RecoveryPolicyRepository } from "../../src/adapters/d1/recovery-policy-repository";
import { RecoveryPolicyService } from "../../src/modules/recovery/recovery-policy-service";

const organizationA = "11111111-1111-4111-8111-111111111111";
const organizationB = "22222222-2222-4222-8222-222222222222";
const ownerId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const firstPolicyId = "55555555-5555-4555-8555-555555555555";
const secondPolicyId = "66666666-6666-4666-8666-666666666666";
const clock = () => new Date("2026-08-24T00:00:00.000Z");

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

async function createSchema(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE policy_sources (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, status TEXT NOT NULL, effective_from TEXT NOT NULL, effective_until TEXT, policy_version INTEGER NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, policy_json TEXT NOT NULL, created_by_user_id TEXT, approved_by_user_id TEXT, approved_at TEXT)"
    ),
    env.DB.prepare(
      "CREATE TABLE audit_events (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, actor_user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, request_id TEXT NOT NULL, reason_code TEXT, created_at TEXT NOT NULL)"
    )
  ]);
}

describe("RecoveryPolicyRepository D1 versioning", () => {
  beforeEach(async () => {
    await createSchema();
  });

  it("versions drafts and retires the prior active policy within one organization", async () => {
    const repository = new RecoveryPolicyRepository(env.DB);
    const policyInput = {
      allowsRecovery: true,
      maxAttemptsPerCase: 2,
      maxMessagesPerContactWindow: 2,
      replyBudgetPerCase: 1
    };
    const first = await repository.createDraft({
      id: firstPolicyId,
      organizationId: organizationA,
      policy: policyInput,
      contentHash: "hash-one",
      createdByUserId: ownerId,
      createdAt: clock().toISOString()
    });
    const second = await repository.createDraft({
      id: secondPolicyId,
      organizationId: organizationA,
      policy: { ...policyInput, allowsRecovery: false },
      contentHash: "hash-two",
      createdByUserId: ownerId,
      createdAt: clock().toISOString()
    });

    expect(first).toMatchObject({ version: 1, status: "inactive", policy: policyInput });
    expect(second).toMatchObject({ version: 2, status: "inactive" });
    await expect(
      repository.activate({
        organizationId: organizationA,
        policyId: firstPolicyId,
        approvedByUserId: ownerId,
        approvedAt: clock().toISOString(),
        requestId
      })
    ).resolves.toBe("activated");
    await expect(
      repository.activate({
        organizationId: organizationA,
        policyId: secondPolicyId,
        approvedByUserId: ownerId,
        approvedAt: clock().toISOString(),
        requestId
      })
    ).resolves.toBe("activated");
    await expect(repository.list(organizationA)).resolves.toMatchObject([
      { id: secondPolicyId, version: 2, status: "active" },
      { id: firstPolicyId, version: 1, status: "retired" }
    ]);
    await expect(repository.list(organizationB)).resolves.toEqual([]);
    await expect(
      env.DB.prepare("SELECT COUNT(*) AS total FROM audit_events WHERE organization_id = ?1")
        .bind(organizationA)
        .first<Record<string, unknown>>()
    ).resolves.toEqual({ total: 2 });
  });

  it("creates a deterministic policy content hash through the pure service", async () => {
    const repository = new RecoveryPolicyRepository(env.DB);
    const service = new RecoveryPolicyService(repository, clock);
    const policy = await service.createDraft(organizationA, ownerId, {
      allowsRecovery: true,
      maxAttemptsPerCase: 1,
      maxMessagesPerContactWindow: 1,
      replyBudgetPerCase: 0
    });
    expect(policy).toMatchObject({ version: 1, status: "inactive" });
    await expect(
      env.DB.prepare("SELECT content_hash FROM policy_sources WHERE id = ?1")
        .bind(policy.id)
        .first<Record<string, unknown>>()
    ).resolves.toMatchObject({ content_hash: expect.stringMatching(/^[a-f0-9]{64}$/u) });
  });
});

import {
  recoveryCaseSchema,
  recoveryPolicySchema,
  type RecoveryCase,
  type RecoveryPolicy
} from "@hala/contracts";

const fixtureTimestamp = "2026-08-23T09:00:00.000Z";

export function createRecoveryCase(overrides: Partial<RecoveryCase> = {}): RecoveryCase {
  return recoveryCaseSchema.parse({
    recoveryCaseId: "11111111-1111-4111-8111-111111111111",
    organizationId: "22222222-2222-4222-8222-222222222222",
    cartId: "cart_fixture_001",
    contactReference: "contact_hash_fixture_001",
    status: "received",
    attemptCount: 0,
    createdAt: fixtureTimestamp,
    updatedAt: fixtureTimestamp,
    ...overrides
  });
}

export function createRecoveryPolicy(overrides: Partial<RecoveryPolicy> = {}): RecoveryPolicy {
  return recoveryPolicySchema.parse({
    policyId: "33333333-3333-4333-8333-333333333333",
    version: 1,
    isActive: true,
    allowsRecovery: true,
    maxAttemptsPerCase: 1,
    maxMessagesPerContactWindow: 1,
    replyBudgetPerCase: 1,
    ...overrides
  });
}

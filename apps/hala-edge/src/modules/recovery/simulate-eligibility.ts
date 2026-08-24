import type { RecoverySimulationInput, SendEligibility } from "@hala/contracts";
import { evaluateSendEligibility } from "./eligibility";

const simulatedOrganizationId = "00000000-0000-4000-8000-000000000001";
const simulatedRecoveryCaseId = "00000000-0000-4000-8000-000000000002";
const simulatedPolicyId = "00000000-0000-4000-8000-000000000003";
const simulatedTimestamp = "2026-08-23T00:00:00.000Z";

export function simulateRecoveryEligibility(input: RecoverySimulationInput): SendEligibility {
  return evaluateSendEligibility({
    recoveryCase: {
      recoveryCaseId: simulatedRecoveryCaseId,
      organizationId: simulatedOrganizationId,
      cartId: "synthetic-cart",
      contactReference: "synthetic-contact-0001",
      status: "qualified",
      attemptCount: input.attemptCount,
      createdAt: simulatedTimestamp,
      updatedAt: simulatedTimestamp
    },
    policy: {
      policyId: simulatedPolicyId,
      version: 1,
      isActive: true,
      allowsRecovery: input.allowsRecovery,
      maxAttemptsPerCase: input.maxAttemptsPerCase,
      maxMessagesPerContactWindow: 1,
      replyBudgetPerCase: 0
    },
    hasConsent: input.hasConsent,
    isSuppressed: input.isSuppressed,
    isCartCompleted: input.isCartCompleted,
    isWithinOrganizationBudget: input.isWithinOrganizationBudget,
    isTemplateApproved: input.isTemplateApproved
  });
}

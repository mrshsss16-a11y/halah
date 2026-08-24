import type { EligibilityInput, SendEligibility } from "@hala/contracts";

export function evaluateSendEligibility(input: EligibilityInput): SendEligibility {
  if (input.isCartCompleted) {
    return { kind: "ineligible", reasonCode: "cart_completed" };
  }

  if (input.isSuppressed) {
    return { kind: "ineligible", reasonCode: "contact_suppressed" };
  }

  if (!input.hasConsent) {
    return { kind: "ineligible", reasonCode: "missing_consent" };
  }

  if (!input.policy.allowsRecovery) {
    return { kind: "ineligible", reasonCode: "policy_disabled" };
  }

  if (input.recoveryCase.attemptCount >= input.policy.maxAttemptsPerCase) {
    return { kind: "ineligible", reasonCode: "attempt_cap_reached" };
  }

  if (!input.isWithinOrganizationBudget) {
    return { kind: "ineligible", reasonCode: "organization_budget_exceeded" };
  }

  if (!input.isTemplateApproved) {
    return { kind: "ineligible", reasonCode: "template_not_approved" };
  }

  return { kind: "eligible", reasonCode: "eligible" };
}

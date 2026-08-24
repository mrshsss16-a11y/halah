import { createRecoveryCase, createRecoveryPolicy } from "@hala/test-kit";
import { describe, expect, it } from "vitest";
import { evaluateSendEligibility } from "../../src/modules/recovery/eligibility";

describe("evaluateSendEligibility", () => {
  const baseInput = {
    recoveryCase: createRecoveryCase(),
    policy: createRecoveryPolicy(),
    hasConsent: true,
    isSuppressed: false,
    isCartCompleted: false,
    isWithinOrganizationBudget: true,
    isTemplateApproved: true
  };

  it("approves an eligible recovery case", () => {
    expect(evaluateSendEligibility(baseInput)).toEqual({
      kind: "eligible",
      reasonCode: "eligible"
    });
  });

  it("blocks a completed cart before any other condition", () => {
    const decision = evaluateSendEligibility({
      ...baseInput,
      isCartCompleted: true,
      isSuppressed: true
    });

    expect(decision).toEqual({ kind: "ineligible", reasonCode: "cart_completed" });
  });

  it("blocks a suppressed contact", () => {
    const decision = evaluateSendEligibility({ ...baseInput, isSuppressed: true });

    expect(decision).toEqual({ kind: "ineligible", reasonCode: "contact_suppressed" });
  });

  it("blocks a contact without consent", () => {
    const decision = evaluateSendEligibility({ ...baseInput, hasConsent: false });

    expect(decision).toEqual({ kind: "ineligible", reasonCode: "missing_consent" });
  });

  it("blocks when the policy has disabled recovery", () => {
    const decision = evaluateSendEligibility({
      ...baseInput,
      policy: createRecoveryPolicy({ allowsRecovery: false })
    });

    expect(decision).toEqual({ kind: "ineligible", reasonCode: "policy_disabled" });
  });

  it("blocks when the attempt cap has been reached", () => {
    const decision = evaluateSendEligibility({
      ...baseInput,
      recoveryCase: createRecoveryCase({ attemptCount: 1 }),
      policy: createRecoveryPolicy({ maxAttemptsPerCase: 1 })
    });

    expect(decision).toEqual({ kind: "ineligible", reasonCode: "attempt_cap_reached" });
  });
});

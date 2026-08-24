import { describe, expect, it } from "vitest";
import { simulateRecoveryEligibility } from "../../src/modules/recovery/simulate-eligibility";

const eligibleInput = {
  allowsRecovery: true,
  hasConsent: true,
  isSuppressed: false,
  isCartCompleted: false,
  isWithinOrganizationBudget: true,
  isTemplateApproved: true,
  attemptCount: 0,
  maxAttemptsPerCase: 1
};

describe("recovery eligibility simulation", () => {
  it("returns eligible only when every safety gate passes", () => {
    expect(simulateRecoveryEligibility(eligibleInput)).toEqual({
      kind: "eligible",
      reasonCode: "eligible"
    });
  });

  it("prioritizes completed cart over all later gates", () => {
    expect(
      simulateRecoveryEligibility({ ...eligibleInput, isCartCompleted: true, hasConsent: false })
    ).toEqual({ kind: "ineligible", reasonCode: "cart_completed" });
  });

  it("blocks a contact without consent", () => {
    expect(simulateRecoveryEligibility({ ...eligibleInput, hasConsent: false })).toEqual({
      kind: "ineligible",
      reasonCode: "missing_consent"
    });
  });

  it("blocks an unapproved template even when policy and budget pass", () => {
    expect(simulateRecoveryEligibility({ ...eligibleInput, isTemplateApproved: false })).toEqual({
      kind: "ineligible",
      reasonCode: "template_not_approved"
    });
  });
});

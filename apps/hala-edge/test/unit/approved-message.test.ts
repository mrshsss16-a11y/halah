import type { ApprovedMessageRequest, SendEligibility } from "@hala/contracts";
import { describe, expect, it } from "vitest";
import { createApprovedMessage } from "../../src/modules/messaging/approved-message";

const request: ApprovedMessageRequest = {
  organizationId: "22222222-2222-4222-8222-222222222222",
  recoveryCaseId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: "44444444-4444-4444-8444-444444444444",
  templateId: "abandoned_cart_v1",
  category: "marketing",
  checkoutUrl: "https://demo.example.test/checkout/cart_fixture_001",
  policyId: "33333333-3333-4333-8333-333333333333",
  policyVersion: 1
};

describe("createApprovedMessage", () => {
  it("returns an approved request only after eligibility succeeds", () => {
    const eligibility: SendEligibility = { kind: "eligible", reasonCode: "eligible" };

    expect(createApprovedMessage({ eligibility, request })).toEqual({
      kind: "approved",
      request
    });
  });

  it("returns a blocking reason without exposing the request when ineligible", () => {
    const eligibility: SendEligibility = {
      kind: "ineligible",
      reasonCode: "contact_suppressed"
    };

    expect(createApprovedMessage({ eligibility, request })).toEqual({
      kind: "blocked",
      reasonCode: "contact_suppressed"
    });
  });
});

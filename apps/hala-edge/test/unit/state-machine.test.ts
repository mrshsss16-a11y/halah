import { createRecoveryCase } from "@hala/test-kit";
import { describe, expect, it } from "vitest";
import { transitionRecoveryCase } from "../../src/modules/recovery/state-machine";

const timestamp = "2026-08-23T10:00:00.000Z";

describe("transitionRecoveryCase", () => {
  it("accepts a valid received to qualified transition", () => {
    const result = transitionRecoveryCase(createRecoveryCase(), "qualified", timestamp);

    expect(result.kind).toBe("accepted");
    if (result.kind === "accepted") {
      expect(result.recoveryCase.status).toBe("qualified");
      expect(result.recoveryCase.updatedAt).toBe(timestamp);
    }
  });

  it("rejects direct sending before a case is scheduled", () => {
    const result = transitionRecoveryCase(createRecoveryCase(), "sent", timestamp);

    expect(result).toEqual({
      kind: "rejected",
      reasonCode: "invalid_transition",
      currentStatus: "received",
      requestedStatus: "sent"
    });
  });

  it("never reopens a purchased case", () => {
    const purchasedCase = createRecoveryCase({ status: "purchased" });
    const result = transitionRecoveryCase(purchasedCase, "scheduled", timestamp);

    expect(result).toEqual({
      kind: "rejected",
      reasonCode: "invalid_transition",
      currentStatus: "purchased",
      requestedStatus: "scheduled"
    });
  });
});

import { createRecoveryPolicy } from "@hala/test-kit";
import { describe, expect, it } from "vitest";
import { resolveEffectivePolicy } from "../../src/modules/policies/policy-gate";

const now = "2026-08-23T10:00:00.000Z";
const activeSource = {
  sourceId: "55555555-5555-4555-8555-555555555555",
  status: "active" as const,
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  policy: createRecoveryPolicy()
};

describe("resolveEffectivePolicy", () => {
  it("resolves an active policy source inside its effective period", () => {
    const result = resolveEffectivePolicy(activeSource, now);

    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.sourceId).toBe(activeSource.sourceId);
      expect(result.policy.policyId).toBe(activeSource.policy.policyId);
    }
  });

  it("escalates an inactive source", () => {
    const result = resolveEffectivePolicy({ ...activeSource, status: "inactive" }, now);

    expect(result).toEqual({ kind: "escalated", reasonCode: "source_inactive" });
  });

  it("escalates an expired source", () => {
    const result = resolveEffectivePolicy(
      { ...activeSource, effectiveUntil: "2026-08-23T09:59:59.000Z" },
      now
    );

    expect(result).toEqual({ kind: "escalated", reasonCode: "source_expired" });
  });
});

import { describe, expect, it } from "vitest";
import { evaluateOrganizationBudget } from "../../src/modules/costs/budget";

describe("evaluateOrganizationBudget", () => {
  it("allows a delivery that fits the remaining budget", () => {
    expect(
      evaluateOrganizationBudget({
        dailyLimit: 10,
        deliveredCostToday: 6,
        estimatedNextDeliveryCost: 2
      })
    ).toEqual({ kind: "within_budget", remainingAfterSend: 2 });
  });

  it("blocks a delivery that would exceed the daily budget", () => {
    expect(
      evaluateOrganizationBudget({
        dailyLimit: 10,
        deliveredCostToday: 9,
        estimatedNextDeliveryCost: 2
      })
    ).toEqual({ kind: "exceeded", remainingBudget: 1 });
  });

  it("never reports a negative remaining budget", () => {
    expect(
      evaluateOrganizationBudget({
        dailyLimit: 10,
        deliveredCostToday: 12,
        estimatedNextDeliveryCost: 1
      })
    ).toEqual({ kind: "exceeded", remainingBudget: 0 });
  });
});

import { z } from "zod";

const nonNegativeAmountSchema = z.number().finite().min(0);

export const organizationBudgetSchema = z
  .object({
    dailyLimit: nonNegativeAmountSchema,
    deliveredCostToday: nonNegativeAmountSchema,
    estimatedNextDeliveryCost: nonNegativeAmountSchema
  })
  .strict();

export type OrganizationBudget = z.infer<typeof organizationBudgetSchema>;

export type BudgetDecision =
  | Readonly<{ kind: "within_budget"; remainingAfterSend: number }>
  | Readonly<{ kind: "exceeded"; remainingBudget: number }>;

export function evaluateOrganizationBudget(input: OrganizationBudget): BudgetDecision {
  const remainingBudget = input.dailyLimit - input.deliveredCostToday;
  const remainingAfterSend = remainingBudget - input.estimatedNextDeliveryCost;

  if (remainingAfterSend < 0) {
    return {
      kind: "exceeded",
      remainingBudget: Math.max(0, remainingBudget)
    };
  }

  return { kind: "within_budget", remainingAfterSend };
}

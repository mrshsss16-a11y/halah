import { recoveryPolicySchema, type RecoveryPolicy } from "@hala/contracts";
import { z } from "zod";

const policySourceSchema = z
  .object({
    sourceId: z.string().uuid(),
    status: z.enum(["active", "inactive", "retired"]),
    effectiveFrom: z.string().datetime({ offset: true }),
    effectiveUntil: z.string().datetime({ offset: true }).optional(),
    policy: recoveryPolicySchema
  })
  .strict();

export type PolicySource = z.infer<typeof policySourceSchema>;

export type PolicyGateResult =
  | Readonly<{ kind: "resolved"; sourceId: string; policy: RecoveryPolicy }>
  | Readonly<{
      kind: "escalated";
      reasonCode: "invalid_source" | "source_inactive" | "source_not_effective" | "source_expired";
    }>;

export function resolveEffectivePolicy(candidate: unknown, now: string): PolicyGateResult {
  const parsedNow = z.string().datetime({ offset: true }).safeParse(now);
  const parsedSource = policySourceSchema.safeParse(candidate);

  if (!parsedNow.success || !parsedSource.success) {
    return { kind: "escalated", reasonCode: "invalid_source" };
  }

  const nowEpoch = Date.parse(parsedNow.data);
  const effectiveFromEpoch = Date.parse(parsedSource.data.effectiveFrom);

  if (parsedSource.data.status !== "active") {
    return { kind: "escalated", reasonCode: "source_inactive" };
  }

  if (effectiveFromEpoch > nowEpoch) {
    return { kind: "escalated", reasonCode: "source_not_effective" };
  }

  if (parsedSource.data.effectiveUntil !== undefined) {
    const effectiveUntilEpoch = Date.parse(parsedSource.data.effectiveUntil);
    if (effectiveUntilEpoch <= nowEpoch) {
      return { kind: "escalated", reasonCode: "source_expired" };
    }
  }

  return {
    kind: "resolved",
    sourceId: parsedSource.data.sourceId,
    policy: parsedSource.data.policy
  };
}

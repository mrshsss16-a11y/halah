import {
  recoveryCaseSchema,
  recoveryStatusSchema,
  type RecoveryCase,
  type RecoveryStatus
} from "@hala/contracts";

const allowedTransitions: Readonly<Record<RecoveryStatus, readonly RecoveryStatus[]>> = {
  received: ["qualified", "suppressed", "purchased", "cancelled"],
  qualified: ["scheduled", "suppressed", "purchased", "cancelled"],
  scheduled: ["sent", "suppressed", "purchased", "failed", "cancelled"],
  sent: ["purchased", "failed", "cancelled"],
  suppressed: [],
  purchased: [],
  failed: [],
  cancelled: []
};

export type RecoveryTransitionResult =
  | Readonly<{ kind: "accepted"; recoveryCase: RecoveryCase }>
  | Readonly<{
      kind: "rejected";
      reasonCode: "invalid_transition";
      currentStatus: RecoveryStatus;
      requestedStatus: RecoveryStatus;
    }>;

export function transitionRecoveryCase(
  recoveryCase: RecoveryCase,
  requestedStatus: RecoveryStatus,
  updatedAt: string
): RecoveryTransitionResult {
  const parsedStatus = recoveryStatusSchema.safeParse(requestedStatus);

  if (!parsedStatus.success) {
    return {
      kind: "rejected",
      reasonCode: "invalid_transition",
      currentStatus: recoveryCase.status,
      requestedStatus: "cancelled"
    };
  }

  const permittedStatuses = allowedTransitions[recoveryCase.status];
  const isPermitted = permittedStatuses.includes(parsedStatus.data);

  if (!isPermitted) {
    return {
      kind: "rejected",
      reasonCode: "invalid_transition",
      currentStatus: recoveryCase.status,
      requestedStatus: parsedStatus.data
    };
  }

  const nextCase = recoveryCaseSchema.parse({
    ...recoveryCase,
    status: parsedStatus.data,
    updatedAt
  });

  return { kind: "accepted", recoveryCase: nextCase };
}

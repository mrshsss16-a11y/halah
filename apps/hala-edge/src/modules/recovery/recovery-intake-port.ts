export type RecoveryIntakeRecord = Readonly<{
  id: string;
  organizationId: string;
  externalCartId: string;
  contactHash: string;
  requestId: string;
  auditEventId: string;
  createdAt: string;
}>;

export type RecordRecoveryIntakeOutcome =
  | Readonly<{ kind: "recorded"; recoveryCaseId: string }>
  | Readonly<{ kind: "duplicate" }>;

export interface RecoveryIntakePort {
  record(input: RecoveryIntakeRecord): Promise<RecordRecoveryIntakeOutcome>;
}

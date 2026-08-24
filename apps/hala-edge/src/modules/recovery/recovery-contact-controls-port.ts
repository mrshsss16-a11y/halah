import type { RecoveryConsentUpdate, RecoverySuppressionUpdate } from "@hala/contracts";

export interface RecoveryContactControlsRepositoryPort {
  upsertConsent(input: {
    organizationId: string;
    actorUserId: string;
    update: RecoveryConsentUpdate;
    recordedAt: string;
    requestId: string;
  }): Promise<void>;
  upsertSuppression(input: {
    organizationId: string;
    actorUserId: string;
    update: RecoverySuppressionUpdate;
    createdAt: string;
    requestId: string;
  }): Promise<void>;
  removeSuppression(input: {
    organizationId: string;
    actorUserId: string;
    contactHash: string;
    removedAt: string;
    requestId: string;
  }): Promise<"removed" | "missing">;
}

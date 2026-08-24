import type { RecoveryConsentUpdate, RecoverySuppressionUpdate } from "@hala/contracts";
import type { RecoveryContactControlsRepositoryPort } from "./recovery-contact-controls-port";

export class RecoveryContactControlsService {
  public constructor(
    private readonly repository: RecoveryContactControlsRepositoryPort,
    private readonly clock: () => Date = () => new Date()
  ) {}

  public async updateConsent(
    organizationId: string,
    actorUserId: string,
    requestId: string,
    update: RecoveryConsentUpdate
  ): Promise<void> {
    await this.repository.upsertConsent({
      organizationId,
      actorUserId,
      update,
      recordedAt: this.clock().toISOString(),
      requestId
    });
  }

  public async updateSuppression(
    organizationId: string,
    actorUserId: string,
    requestId: string,
    update: RecoverySuppressionUpdate
  ): Promise<void> {
    await this.repository.upsertSuppression({
      organizationId,
      actorUserId,
      update,
      createdAt: this.clock().toISOString(),
      requestId
    });
  }

  public async removeSuppression(
    organizationId: string,
    actorUserId: string,
    requestId: string,
    contactHash: string
  ): Promise<"removed" | "missing"> {
    return this.repository.removeSuppression({
      organizationId,
      actorUserId,
      contactHash,
      removedAt: this.clock().toISOString(),
      requestId
    });
  }
}

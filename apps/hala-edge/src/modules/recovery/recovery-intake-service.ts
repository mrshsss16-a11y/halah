import type { RecoveryIntakePort, RecordRecoveryIntakeOutcome } from "./recovery-intake-port";

export type ReceiveRecoveryIntakeInput = Readonly<{
  organizationId: string;
  externalCartId: string;
  contactHash: string;
  requestId: string;
}>;

export type ReceiveRecoveryIntakeOutcome =
  | Readonly<{ kind: "recorded"; recoveryCaseId: string }>
  | Readonly<{ kind: "duplicate" }>
  | Readonly<{ kind: "invalid_input" }>;

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

export class RecoveryIntakeService {
  public constructor(
    private readonly port: RecoveryIntakePort,
    private readonly clock: () => Date = () => new Date()
  ) {}

  public async receive(input: ReceiveRecoveryIntakeInput): Promise<ReceiveRecoveryIntakeOutcome> {
    if (
      !hasText(input.organizationId) ||
      !hasText(input.externalCartId) ||
      !hasText(input.contactHash) ||
      !hasText(input.requestId)
    ) {
      return { kind: "invalid_input" };
    }

    const outcome: RecordRecoveryIntakeOutcome = await this.port.record({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      externalCartId: input.externalCartId.trim(),
      contactHash: input.contactHash.trim(),
      requestId: input.requestId.trim(),
      auditEventId: crypto.randomUUID(),
      createdAt: this.clock().toISOString()
    });

    return outcome;
  }
}

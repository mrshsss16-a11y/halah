import { describe, expect, it } from "vitest";
import type {
  RecordRecoveryIntakeOutcome,
  RecoveryIntakePort,
  RecoveryIntakeRecord
} from "../../src/modules/recovery/recovery-intake-port";
import { RecoveryIntakeService } from "../../src/modules/recovery/recovery-intake-service";

class FakeRecoveryIntakePort implements RecoveryIntakePort {
  public records: RecoveryIntakeRecord[] = [];
  public outcome: RecordRecoveryIntakeOutcome = {
    kind: "recorded",
    recoveryCaseId: "recovery-case-1"
  };

  public async record(input: RecoveryIntakeRecord): Promise<RecordRecoveryIntakeOutcome> {
    this.records.push(input);
    return this.outcome;
  }
}

describe("recovery intake service", () => {
  it("records a received case with hashed contact input only", async () => {
    const port = new FakeRecoveryIntakePort();
    const service = new RecoveryIntakeService(port, () => new Date("2026-08-24T12:00:00.000Z"));

    await expect(
      service.receive({
        organizationId: "org-a",
        externalCartId: "cart-a",
        contactHash: "hashed-contact-reference",
        requestId: "request-a"
      })
    ).resolves.toEqual({ kind: "recorded", recoveryCaseId: "recovery-case-1" });

    expect(port.records).toHaveLength(1);
    expect(port.records[0]).toMatchObject({
      organizationId: "org-a",
      externalCartId: "cart-a",
      contactHash: "hashed-contact-reference",
      requestId: "request-a",
      createdAt: "2026-08-24T12:00:00.000Z"
    });
    expect(port.records[0]?.auditEventId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("passes duplicate results through without creating a send workflow", async () => {
    const port = new FakeRecoveryIntakePort();
    port.outcome = { kind: "duplicate" };
    const service = new RecoveryIntakeService(port);

    await expect(
      service.receive({
        organizationId: "org-a",
        externalCartId: "cart-a",
        contactHash: "hashed-contact-reference",
        requestId: "request-a"
      })
    ).resolves.toEqual({ kind: "duplicate" });
  });

  it("rejects incomplete intake before persistence", async () => {
    const port = new FakeRecoveryIntakePort();
    const service = new RecoveryIntakeService(port);

    await expect(
      service.receive({
        organizationId: "",
        externalCartId: "cart-a",
        contactHash: "hashed-contact-reference",
        requestId: "request-a"
      })
    ).resolves.toEqual({ kind: "invalid_input" });
    expect(port.records).toHaveLength(0);
  });
});

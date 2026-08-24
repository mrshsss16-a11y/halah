import { describe, expect, it } from "vitest";
import type {
  ConsumeSallaOAuthStateOutcome,
  SallaOAuthStatePort,
  SallaOAuthStateRecord
} from "../../src/modules/salla/salla-oauth-state-port";
import { SallaOAuthStateService } from "../../src/modules/salla/salla-oauth-state-service";

class InMemorySallaOAuthStatePort implements SallaOAuthStatePort {
  public readonly records: SallaOAuthStateRecord[] = [];

  public async create(record: SallaOAuthStateRecord): Promise<void> {
    this.records.push(record);
  }

  public async consume(input: {
    stateHash: string;
    now: string;
  }): Promise<ConsumeSallaOAuthStateOutcome> {
    const recordIndex = this.records.findIndex((record) => record.stateHash === input.stateHash);
    if (recordIndex === -1) {
      return { kind: "missing_or_expired" };
    }

    const record = this.records[recordIndex];
    if (record === undefined || record.expiresAt <= input.now) {
      return { kind: "missing_or_expired" };
    }

    this.records.splice(recordIndex, 1);
    return { kind: "accepted", organizationId: record.organizationId };
  }
}

describe("Salla OAuth state service", () => {
  it("stores only a hash and accepts a random state once", async () => {
    const port = new InMemorySallaOAuthStatePort();
    const service = new SallaOAuthStateService(port, () => new Date("2026-08-24T00:00:00.000Z"));

    const created = await service.create({ organizationId: "org-test" });

    expect(created.rawState).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(created.expiresAt).toBe("2026-08-24T00:10:00.000Z");
    expect(port.records).toHaveLength(1);
    expect(port.records[0]?.stateHash).not.toBe(created.rawState);

    await expect(service.consume(created.rawState)).resolves.toEqual({
      kind: "accepted",
      organizationId: "org-test"
    });
    await expect(service.consume(created.rawState)).resolves.toEqual({
      kind: "missing_or_expired"
    });
  });

  it("rejects an empty callback state without touching persistence", async () => {
    const port = new InMemorySallaOAuthStatePort();
    const service = new SallaOAuthStateService(port);

    await expect(service.consume("  ")).resolves.toEqual({ kind: "missing_or_expired" });
    expect(port.records).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import type { SallaConnectionPort } from "../../src/modules/salla/salla-connection-port";
import { SallaConnectionService } from "../../src/modules/salla/salla-connection-service";
import type {
  ConsumeSallaOAuthStateOutcome,
  SallaOAuthStatePort,
  SallaOAuthStateRecord
} from "../../src/modules/salla/salla-oauth-state-port";
import { SallaOAuthStateService } from "../../src/modules/salla/salla-oauth-state-service";

class FakeOAuthStatePort implements SallaOAuthStatePort {
  private readonly records = new Map<string, SallaOAuthStateRecord>();
  private readonly consumed = new Set<string>();

  public async create(record: SallaOAuthStateRecord): Promise<void> {
    this.records.set(record.stateHash, record);
  }

  public async consume(input: {
    stateHash: string;
    now: string;
  }): Promise<ConsumeSallaOAuthStateOutcome> {
    const record = this.records.get(input.stateHash);
    if (record === undefined || record.expiresAt <= input.now) {
      return { kind: "missing_or_expired" };
    }
    if (this.consumed.has(input.stateHash)) {
      return { kind: "already_consumed" };
    }
    this.consumed.add(input.stateHash);
    return { kind: "accepted", organizationId: record.organizationId };
  }
}

class FakeSallaConnectionPort implements SallaConnectionPort {
  public authorizingOrganizations: string[] = [];
  public activatedOrganizations: string[] = [];
  public allowActivation = true;

  public async markAuthorizing(input: { organizationId: string }): Promise<void> {
    this.authorizingOrganizations.push(input.organizationId);
  }

  public async activateLocalMock(input: { organizationId: string }): Promise<boolean> {
    if (!this.allowActivation || !this.authorizingOrganizations.includes(input.organizationId)) {
      return false;
    }
    this.activatedOrganizations.push(input.organizationId);
    return true;
  }
}

describe("Salla connection service", () => {
  it("starts and completes a local authorization using an OAuth state once", async () => {
    const clock = () => new Date("2026-08-24T12:00:00.000Z");
    const oauthStateService = new SallaOAuthStateService(new FakeOAuthStatePort(), clock);
    const connections = new FakeSallaConnectionPort();
    const service = new SallaConnectionService(oauthStateService, connections, clock);

    const started = await service.startLocalAuthorization({ organizationId: "org-a" });

    expect(started.kind).toBe("authorization_started");
    expect(started.expiresAt).toBe("2026-08-24T12:10:00.000Z");
    expect(connections.authorizingOrganizations).toEqual(["org-a"]);
    await expect(service.completeLocalAuthorization(started.state)).resolves.toEqual({
      kind: "connected",
      organizationId: "org-a"
    });
    expect(connections.activatedOrganizations).toEqual(["org-a"]);
    await expect(service.completeLocalAuthorization(started.state)).resolves.toEqual({
      kind: "state_already_consumed"
    });
  });

  it("does not claim a connection if storage cannot transition it from authorizing", async () => {
    const clock = () => new Date("2026-08-24T12:00:00.000Z");
    const oauthStateService = new SallaOAuthStateService(new FakeOAuthStatePort(), clock);
    const connections = new FakeSallaConnectionPort();
    connections.allowActivation = false;
    const service = new SallaConnectionService(oauthStateService, connections, clock);

    const started = await service.startLocalAuthorization({ organizationId: "org-a" });

    await expect(service.completeLocalAuthorization(started.state)).resolves.toEqual({
      kind: "connection_not_authorizing"
    });
  });
});

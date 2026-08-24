import { describe, expect, it } from "vitest";
import type {
  ActiveOrganizationMembership,
  CreateIdentityRecord,
  IdentityUser,
  StoredCredential
} from "../../src/adapters/d1/identity-repository";
import { IdentityRepository } from "../../src/adapters/d1/identity-repository";
import { IdentityService } from "../../src/modules/identity/identity-service";
import { hashSessionToken } from "../../src/security/session-token";

type StoredSession = Readonly<{
  sessionId: string;
  userId: string;
  organizationId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}>;

type SessionInput = Readonly<{
  sessionId: string;
  userId: string;
  organizationId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}>;

class FakeIdentityRepository extends IdentityRepository {
  public readonly createdIdentities: CreateIdentityRecord[] = [];
  public readonly sessions: StoredSession[] = [];
  private readonly usersByEmail = new Map<string, IdentityUser>();
  private readonly credentialsByUserId = new Map<string, StoredCredential>();
  private readonly membershipsByUserId = new Map<string, ActiveOrganizationMembership>();

  public constructor() {
    super({} as D1Database);
  }

  public override async findUserByEmail(emailNormalized: string): Promise<IdentityUser | null> {
    return this.usersByEmail.get(emailNormalized) ?? null;
  }

  public override async findCredentialByUserId(userId: string): Promise<StoredCredential | null> {
    return this.credentialsByUserId.get(userId) ?? null;
  }

  public override async findDefaultActiveMembership(
    userId: string
  ): Promise<ActiveOrganizationMembership | null> {
    return this.membershipsByUserId.get(userId) ?? null;
  }

  public removeMembership(userId: string): void {
    this.membershipsByUserId.delete(userId);
  }

  public override async createOwnerIdentity(record: CreateIdentityRecord): Promise<void> {
    this.createdIdentities.push(record);
    this.usersByEmail.set(
      record.emailNormalized,
      Object.freeze({
        id: record.userId,
        emailNormalized: record.emailNormalized,
        status: "active"
      })
    );
    this.membershipsByUserId.set(
      record.userId,
      Object.freeze({ organizationId: record.organizationId })
    );
    this.credentialsByUserId.set(
      record.userId,
      Object.freeze({
        userId: record.userId,
        passwordSalt: record.passwordSalt,
        passwordHash: record.passwordHash,
        algorithm: "PBKDF2-SHA-256",
        iterations: record.passwordIterations
      })
    );
  }

  public override async createSession(input: SessionInput): Promise<void> {
    this.sessions.push(Object.freeze({ ...input }));
  }
}

const fixedClock = (): Date => new Date("2026-08-23T10:00:00.000Z");

describe("IdentityService", () => {
  it("creates an owner identity and persists a hashed—not raw—session token", async () => {
    const repository = new FakeIdentityRepository();
    const service = new IdentityService(repository, fixedClock);
    const outcome = await service.signUp({
      organizationName: "متجر تجربة",
      email: "owner@example.test",
      password: "TestOnlyPassword-2026"
    });

    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") {
      throw new Error("Expected a newly created identity.");
    }

    const record = repository.createdIdentities.at(0);
    const storedSession = repository.sessions.at(0);
    expect(record).toBeDefined();
    expect(storedSession).toBeDefined();
    if (record === undefined || storedSession === undefined) {
      throw new Error("Expected stored identity and session records.");
    }

    expect(record.emailNormalized).toBe("owner@example.test");
    expect(storedSession.organizationId).toBe(record.organizationId);
    expect(record.passwordHash).not.toContain("TestOnlyPassword-2026");
    expect(record.passwordSalt).not.toContain("TestOnlyPassword-2026");
    expect(storedSession.tokenHash).not.toBe(outcome.session.rawToken);
    await expect(hashSessionToken(outcome.session.rawToken)).resolves.toBe(storedSession.tokenHash);
    expect(outcome.session.expiresAt).toBe("2026-08-30T10:00:00.000Z");
  });

  it("refuses duplicate email registration without issuing another session", async () => {
    const repository = new FakeIdentityRepository();
    const service = new IdentityService(repository, fixedClock);
    await service.signUp({
      organizationName: "متجر تجربة",
      email: "owner@example.test",
      password: "TestOnlyPassword-2026"
    });

    const duplicate = await service.signUp({
      organizationName: "مساحة مختلفة",
      email: "owner@example.test",
      password: "AnotherTestPassword-2026"
    });

    expect(duplicate).toEqual({ kind: "email_taken" });
    expect(repository.createdIdentities).toHaveLength(1);
    expect(repository.sessions).toHaveLength(1);
  });

  it("authenticates only the owner with the correct password and adds a new hashed session", async () => {
    const repository = new FakeIdentityRepository();
    const service = new IdentityService(repository, fixedClock);
    await service.signUp({
      organizationName: "متجر تجربة",
      email: "owner@example.test",
      password: "TestOnlyPassword-2026"
    });

    await expect(
      service.login({ email: "owner@example.test", password: "WrongPassword-2026" })
    ).resolves.toEqual({ kind: "invalid_credentials" });

    const authenticated = await service.login({
      email: "owner@example.test",
      password: "TestOnlyPassword-2026"
    });

    expect(authenticated.kind).toBe("authenticated");
    if (authenticated.kind !== "authenticated") {
      throw new Error("Expected authenticated login.");
    }

    expect(repository.sessions).toHaveLength(2);
    const latestSession = repository.sessions.at(-1);
    expect(latestSession).toBeDefined();
    if (latestSession === undefined) {
      throw new Error("Expected latest session.");
    }
    await expect(hashSessionToken(authenticated.session.rawToken)).resolves.toBe(
      latestSession.tokenHash
    );
  });

  it("does not issue a session when the account has no active organization membership", async () => {
    const repository = new FakeIdentityRepository();
    const service = new IdentityService(repository, fixedClock);
    await service.signUp({
      organizationName: "متجر تجربة",
      email: "owner@example.test",
      password: "TestOnlyPassword-2026"
    });
    const record = repository.createdIdentities.at(0);
    if (record === undefined) {
      throw new Error("Expected created identity record.");
    }
    repository.removeMembership(record.userId);

    await expect(
      service.login({ email: "owner@example.test", password: "TestOnlyPassword-2026" })
    ).resolves.toEqual({ kind: "invalid_credentials" });
    expect(repository.sessions).toHaveLength(1);
  });

  it("returns one safe credential error for a missing account", async () => {
    const repository = new FakeIdentityRepository();
    const service = new IdentityService(repository, fixedClock);

    await expect(
      service.login({ email: "unknown@example.test", password: "TestOnlyPassword-2026" })
    ).resolves.toEqual({ kind: "invalid_credentials" });
  });
});

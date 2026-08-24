import { describe, expect, it } from "vitest";
import {
  decryptCredentialPayload,
  encryptCredentialPayload
} from "../../src/security/credential-vault";
import { CredentialVaultService } from "../../src/modules/connections/credential-vault-service";
import type {
  CredentialVaultRepositoryPort,
  StoredCredentialEnvelope
} from "../../src/modules/connections/credential-vault-port";

const connectionId = "11111111-1111-4111-8111-111111111111";
const testKey = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const otherKey = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";

class FakeCredentialVaultRepository implements CredentialVaultRepositoryPort {
  public stored: StoredCredentialEnvelope | null = null;
  public leaseId: string | null = null;
  public async find(): Promise<StoredCredentialEnvelope | null> {
    return this.stored;
  }
  public async store(input: {
    connectionId: string;
    keyVersion: number;
    encryptedPayload: string;
    expiresAt: string | null;
  }): Promise<void> {
    this.stored = {
      connectionId: input.connectionId,
      provider: "salla",
      keyVersion: input.keyVersion,
      encryptedPayload: input.encryptedPayload,
      expiresAt: input.expiresAt,
      lastRefreshedAt: null
    };
  }
  public async acquireRefreshLease(input: { leaseId: string }): Promise<boolean> {
    if (this.leaseId !== null) {
      return false;
    }
    this.leaseId = input.leaseId;
    return true;
  }
  public async replaceAfterRefresh(input: {
    connectionId: string;
    leaseId: string;
    keyVersion: number;
    encryptedPayload: string;
    expiresAt: string | null;
  }): Promise<boolean> {
    if (this.leaseId !== input.leaseId || this.stored === null) {
      return false;
    }
    this.stored = {
      ...this.stored,
      connectionId: input.connectionId,
      keyVersion: input.keyVersion,
      encryptedPayload: input.encryptedPayload,
      expiresAt: input.expiresAt
    };
    this.leaseId = null;
    return true;
  }
  public async markReauthorizationRequired(): Promise<void> {}
}

describe("credential vault encryption", () => {
  it("encrypts credentials with connection and provider binding", async () => {
    const plaintext = JSON.stringify({
      provider: "salla",
      accessToken: "synthetic-access-token",
      refreshToken: "synthetic-refresh-token"
    });
    const encrypted = await encryptCredentialPayload({
      plaintext,
      rawKey: testKey,
      keyVersion: 1,
      provider: "salla",
      connectionId
    });

    expect(encrypted.ciphertext).not.toContain("synthetic-access-token");
    await expect(
      decryptCredentialPayload({
        ciphertext: encrypted.ciphertext,
        rawKey: testKey,
        keyVersion: 1,
        provider: "salla",
        connectionId
      })
    ).resolves.toBe(plaintext);
    await expect(
      decryptCredentialPayload({
        ciphertext: encrypted.ciphertext,
        rawKey: otherKey,
        keyVersion: 1,
        provider: "salla",
        connectionId
      })
    ).resolves.toBeNull();
    await expect(
      decryptCredentialPayload({
        ciphertext: encrypted.ciphertext,
        rawKey: testKey,
        keyVersion: 1,
        provider: "zid",
        connectionId
      })
    ).resolves.toBeNull();
  });

  it("stores only ciphertext and serializes the refresh lease", async () => {
    const repository = new FakeCredentialVaultRepository();
    const service = new CredentialVaultService(
      repository,
      () => new Date("2026-08-24T00:00:00.000Z")
    );
    await service.store({
      connectionId,
      provider: "salla",
      payload: {
        provider: "salla",
        accessToken: "synthetic-access-token",
        refreshToken: "synthetic-refresh-token"
      },
      rawEncryptionKey: testKey,
      keyVersion: 1,
      expiresAt: "2026-08-24T01:00:00.000Z"
    });

    expect(repository.stored?.encryptedPayload).not.toContain("synthetic-refresh-token");
    await expect(service.read({ connectionId, rawEncryptionKey: testKey })).resolves.toMatchObject({
      kind: "available",
      payload: { provider: "salla", accessToken: "synthetic-access-token" }
    });
    const firstLease = await service.acquireRefreshLease(connectionId);
    const secondLease = await service.acquireRefreshLease(connectionId);
    expect(firstLease.kind).toBe("acquired");
    expect(secondLease).toEqual({ kind: "busy" });
  });
});

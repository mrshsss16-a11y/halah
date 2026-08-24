import {
  decryptCredentialPayload,
  encryptCredentialPayload
} from "../../security/credential-vault";
import type {
  CredentialVaultRepositoryPort,
  StoreCredentialPayload,
  StoreProvider
} from "./credential-vault-port";

function isValidCredentialPayload(
  value: unknown,
  provider: StoreProvider
): value is StoreCredentialPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (provider === "salla") {
    return (
      record["provider"] === "salla" &&
      typeof record["accessToken"] === "string" &&
      record["accessToken"].length > 0 &&
      typeof record["refreshToken"] === "string" &&
      record["refreshToken"].length > 0
    );
  }
  return (
    record["provider"] === "zid" &&
    typeof record["authorizationToken"] === "string" &&
    record["authorizationToken"].length > 0 &&
    typeof record["managerToken"] === "string" &&
    record["managerToken"].length > 0 &&
    typeof record["refreshToken"] === "string" &&
    record["refreshToken"].length > 0
  );
}

export class CredentialVaultService {
  public constructor(
    private readonly repository: CredentialVaultRepositoryPort,
    private readonly clock: () => Date = () => new Date()
  ) {}

  public async store(input: {
    connectionId: string;
    provider: StoreProvider;
    payload: StoreCredentialPayload;
    rawEncryptionKey: string;
    keyVersion: number;
    expiresAt: string | null;
  }): Promise<void> {
    if (input.payload.provider !== input.provider) {
      throw new Error("credential_provider_mismatch");
    }
    const now = this.clock().toISOString();
    const encrypted = await encryptCredentialPayload({
      plaintext: JSON.stringify(input.payload),
      rawKey: input.rawEncryptionKey,
      keyVersion: input.keyVersion,
      provider: input.provider,
      connectionId: input.connectionId
    });
    await this.repository.store({
      connectionId: input.connectionId,
      keyVersion: encrypted.keyVersion,
      encryptedPayload: encrypted.ciphertext,
      expiresAt: input.expiresAt,
      updatedAt: now
    });
  }

  public async read(input: {
    connectionId: string;
    rawEncryptionKey: string;
  }): Promise<
    | Readonly<{ kind: "available"; payload: StoreCredentialPayload; expiresAt: string | null }>
    | Readonly<{ kind: "unavailable" }>
  > {
    const stored = await this.repository.find(input.connectionId);
    if (stored === null) {
      return Object.freeze({ kind: "unavailable" });
    }
    const plaintext = await decryptCredentialPayload({
      ciphertext: stored.encryptedPayload,
      rawKey: input.rawEncryptionKey,
      keyVersion: stored.keyVersion,
      provider: stored.provider,
      connectionId: stored.connectionId
    });
    if (plaintext === null) {
      return Object.freeze({ kind: "unavailable" });
    }
    try {
      const candidate: unknown = JSON.parse(plaintext);
      if (!isValidCredentialPayload(candidate, stored.provider)) {
        return Object.freeze({ kind: "unavailable" });
      }
      return Object.freeze({
        kind: "available",
        payload: Object.freeze(candidate),
        expiresAt: stored.expiresAt
      });
    } catch {
      return Object.freeze({ kind: "unavailable" });
    }
  }

  public async acquireRefreshLease(
    connectionId: string
  ): Promise<Readonly<{ kind: "acquired"; leaseId: string }> | Readonly<{ kind: "busy" }>> {
    const now = this.clock();
    const leaseId = crypto.randomUUID();
    const acquired = await this.repository.acquireRefreshLease({
      connectionId,
      leaseId,
      leaseExpiresAt: new Date(now.getTime() + 1000 * 60 * 2).toISOString(),
      now: now.toISOString()
    });
    return acquired
      ? Object.freeze({ kind: "acquired", leaseId })
      : Object.freeze({ kind: "busy" });
  }

  public async replaceAfterRefresh(input: {
    connectionId: string;
    provider: StoreProvider;
    leaseId: string;
    payload: StoreCredentialPayload;
    rawEncryptionKey: string;
    keyVersion: number;
    expiresAt: string | null;
  }): Promise<boolean> {
    if (input.payload.provider !== input.provider) {
      return false;
    }
    const refreshedAt = this.clock().toISOString();
    const encrypted = await encryptCredentialPayload({
      plaintext: JSON.stringify(input.payload),
      rawKey: input.rawEncryptionKey,
      keyVersion: input.keyVersion,
      provider: input.provider,
      connectionId: input.connectionId
    });
    return this.repository.replaceAfterRefresh({
      connectionId: input.connectionId,
      leaseId: input.leaseId,
      keyVersion: encrypted.keyVersion,
      encryptedPayload: encrypted.ciphertext,
      expiresAt: input.expiresAt,
      refreshedAt
    });
  }

  public async markReauthorizationRequired(connectionId: string): Promise<void> {
    await this.repository.markReauthorizationRequired({
      connectionId,
      updatedAt: this.clock().toISOString()
    });
  }
}

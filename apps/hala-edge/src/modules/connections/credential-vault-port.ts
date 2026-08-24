export type StoreProvider = "salla" | "zid";

export type StoreCredentialPayload =
  | Readonly<{ provider: "salla"; accessToken: string; refreshToken: string }>
  | Readonly<{
      provider: "zid";
      authorizationToken: string;
      managerToken: string;
      refreshToken: string;
    }>;

export type StoredCredentialEnvelope = Readonly<{
  connectionId: string;
  provider: StoreProvider;
  keyVersion: number;
  encryptedPayload: string;
  expiresAt: string | null;
  lastRefreshedAt: string | null;
}>;

export interface CredentialVaultRepositoryPort {
  find(connectionId: string): Promise<StoredCredentialEnvelope | null>;
  store(input: {
    connectionId: string;
    keyVersion: number;
    encryptedPayload: string;
    expiresAt: string | null;
    updatedAt: string;
  }): Promise<void>;
  acquireRefreshLease(input: {
    connectionId: string;
    leaseId: string;
    leaseExpiresAt: string;
    now: string;
  }): Promise<boolean>;
  replaceAfterRefresh(input: {
    connectionId: string;
    leaseId: string;
    keyVersion: number;
    encryptedPayload: string;
    expiresAt: string | null;
    refreshedAt: string;
  }): Promise<boolean>;
  markReauthorizationRequired(input: { connectionId: string; updatedAt: string }): Promise<void>;
}

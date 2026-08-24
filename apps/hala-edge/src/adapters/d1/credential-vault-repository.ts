import type {
  CredentialVaultRepositoryPort,
  StoredCredentialEnvelope
} from "../../modules/connections/credential-vault-port";

function toEnvelope(row: Record<string, unknown>): StoredCredentialEnvelope | null {
  const connectionId = row["connection_id"];
  const provider = row["provider"];
  const keyVersion = row["key_version"];
  const encryptedPayload = row["encrypted_payload"];
  const expiresAt = row["expires_at"];
  const lastRefreshedAt = row["last_refreshed_at"];
  if (
    typeof connectionId !== "string" ||
    (provider !== "salla" && provider !== "zid") ||
    typeof keyVersion !== "number" ||
    !Number.isInteger(keyVersion) ||
    keyVersion < 1 ||
    typeof encryptedPayload !== "string" ||
    (expiresAt !== null && typeof expiresAt !== "string") ||
    (lastRefreshedAt !== null && typeof lastRefreshedAt !== "string")
  ) {
    return null;
  }
  return Object.freeze({
    connectionId,
    provider,
    keyVersion,
    encryptedPayload,
    expiresAt,
    lastRefreshedAt
  });
}

export class CredentialVaultRepository implements CredentialVaultRepositoryPort {
  public constructor(private readonly database: D1Database) {}

  public async find(connectionId: string): Promise<StoredCredentialEnvelope | null> {
    const result = await this.database
      .prepare(
        "SELECT c.id AS connection_id, c.provider, v.key_version, v.encrypted_payload, v.expires_at, v.last_refreshed_at FROM store_connections c JOIN store_connection_credentials v ON v.connection_id = c.id WHERE c.id = ?1 LIMIT 1"
      )
      .bind(connectionId)
      .first<Record<string, unknown>>();
    return result === null ? null : toEnvelope(result);
  }

  public async store(input: {
    connectionId: string;
    keyVersion: number;
    encryptedPayload: string;
    expiresAt: string | null;
    updatedAt: string;
  }): Promise<void> {
    await this.database
      .prepare(
        "INSERT INTO store_connection_credentials (connection_id, key_version, encrypted_payload, expires_at, last_refreshed_at, refresh_lease_id, refresh_lease_expires_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, ?5, ?5) ON CONFLICT(connection_id) DO UPDATE SET key_version = excluded.key_version, encrypted_payload = excluded.encrypted_payload, expires_at = excluded.expires_at, refresh_lease_id = NULL, refresh_lease_expires_at = NULL, updated_at = excluded.updated_at"
      )
      .bind(
        input.connectionId,
        input.keyVersion,
        input.encryptedPayload,
        input.expiresAt,
        input.updatedAt
      )
      .run();
    await this.database
      .prepare(
        "UPDATE store_connections SET credential_key_version = ?2, authorization_expires_at = ?3, updated_at = ?4 WHERE id = ?1"
      )
      .bind(input.connectionId, input.keyVersion, input.expiresAt, input.updatedAt)
      .run();
  }

  public async acquireRefreshLease(input: {
    connectionId: string;
    leaseId: string;
    leaseExpiresAt: string;
    now: string;
  }): Promise<boolean> {
    const result = await this.database
      .prepare(
        "UPDATE store_connection_credentials SET refresh_lease_id = ?2, refresh_lease_expires_at = ?3, updated_at = ?4 WHERE connection_id = ?1 AND (refresh_lease_id IS NULL OR refresh_lease_expires_at IS NULL OR refresh_lease_expires_at <= ?4)"
      )
      .bind(input.connectionId, input.leaseId, input.leaseExpiresAt, input.now)
      .run();
    return result.meta.changes === 1;
  }

  public async replaceAfterRefresh(input: {
    connectionId: string;
    leaseId: string;
    keyVersion: number;
    encryptedPayload: string;
    expiresAt: string | null;
    refreshedAt: string;
  }): Promise<boolean> {
    const updated = await this.database
      .prepare(
        "UPDATE store_connection_credentials SET key_version = ?3, encrypted_payload = ?4, expires_at = ?5, last_refreshed_at = ?6, refresh_lease_id = NULL, refresh_lease_expires_at = NULL, updated_at = ?6 WHERE connection_id = ?1 AND refresh_lease_id = ?2"
      )
      .bind(
        input.connectionId,
        input.leaseId,
        input.keyVersion,
        input.encryptedPayload,
        input.expiresAt,
        input.refreshedAt
      )
      .run();
    if (updated.meta.changes !== 1) {
      return false;
    }
    await this.database
      .prepare(
        "UPDATE store_connections SET credential_key_version = ?2, authorization_expires_at = ?3, status = 'active', updated_at = ?4 WHERE id = ?1"
      )
      .bind(input.connectionId, input.keyVersion, input.expiresAt, input.refreshedAt)
      .run();
    return true;
  }

  public async markReauthorizationRequired(input: {
    connectionId: string;
    updatedAt: string;
  }): Promise<void> {
    await this.database.batch([
      this.database
        .prepare(
          "UPDATE store_connections SET status = 'reauthorization_required', updated_at = ?2 WHERE id = ?1"
        )
        .bind(input.connectionId, input.updatedAt),
      this.database
        .prepare(
          "UPDATE store_connection_credentials SET refresh_lease_id = NULL, refresh_lease_expires_at = NULL, updated_at = ?2 WHERE connection_id = ?1"
        )
        .bind(input.connectionId, input.updatedAt)
    ]);
  }
}

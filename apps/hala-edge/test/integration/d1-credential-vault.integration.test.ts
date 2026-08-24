import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { CredentialVaultRepository } from "../../src/adapters/d1/credential-vault-repository";
import { CredentialVaultService } from "../../src/modules/connections/credential-vault-service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const testKey = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const now = "2026-08-24T00:00:00.000Z";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

async function createSchema(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE store_connections (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, credential_key_version INTEGER NOT NULL, external_store_id TEXT, authorization_scope TEXT, authorization_expires_at TEXT, connected_at TEXT, last_webhook_received_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    ),
    env.DB.prepare(
      "CREATE TABLE store_connection_credentials (connection_id TEXT PRIMARY KEY NOT NULL, key_version INTEGER NOT NULL, encrypted_payload TEXT NOT NULL, expires_at TEXT, last_refreshed_at TEXT, refresh_lease_id TEXT, refresh_lease_expires_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    )
  ]);
  await env.DB.prepare(
    "INSERT INTO store_connections (id, organization_id, provider, status, credential_key_version, created_at, updated_at) VALUES (?1, ?2, 'salla', 'active', 1, ?3, ?3)"
  )
    .bind(connectionId, organizationId, now)
    .run();
}

describe("CredentialVaultRepository D1", () => {
  beforeEach(async () => {
    await createSchema();
  });

  it("serializes refreshes with a lease and never stores synthetic tokens in plaintext", async () => {
    const repository = new CredentialVaultRepository(env.DB);
    const service = new CredentialVaultService(repository, () => new Date(now));
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

    await expect(
      env.DB.prepare(
        "SELECT encrypted_payload, refresh_lease_id FROM store_connection_credentials WHERE connection_id = ?1"
      )
        .bind(connectionId)
        .first<Record<string, unknown>>()
    ).resolves.toMatchObject({ refresh_lease_id: null });
    const raw = await env.DB.prepare(
      "SELECT encrypted_payload FROM store_connection_credentials WHERE connection_id = ?1"
    )
      .bind(connectionId)
      .first<Record<string, unknown>>();
    expect(String(raw?.["encrypted_payload"])).not.toContain("synthetic-refresh-token");

    const firstLease = await service.acquireRefreshLease(connectionId);
    const secondLease = await service.acquireRefreshLease(connectionId);
    expect(firstLease.kind).toBe("acquired");
    expect(secondLease).toEqual({ kind: "busy" });
    if (firstLease.kind !== "acquired") {
      throw new Error("expected_refresh_lease");
    }
    await expect(
      repository.replaceAfterRefresh({
        connectionId,
        leaseId: "wrong-lease",
        keyVersion: 1,
        encryptedPayload: "not-used",
        expiresAt: null,
        refreshedAt: now
      })
    ).resolves.toBe(false);
    await expect(
      service.replaceAfterRefresh({
        connectionId,
        provider: "salla",
        leaseId: firstLease.leaseId,
        payload: {
          provider: "salla",
          accessToken: "replacement-access-token",
          refreshToken: "replacement-refresh-token"
        },
        rawEncryptionKey: testKey,
        keyVersion: 2,
        expiresAt: "2026-08-24T02:00:00.000Z"
      })
    ).resolves.toBe(true);
    await expect(service.read({ connectionId, rawEncryptionKey: testKey })).resolves.toMatchObject({
      kind: "available",
      payload: { accessToken: "replacement-access-token" },
      expiresAt: "2026-08-24T02:00:00.000Z"
    });

    await service.markReauthorizationRequired(connectionId);
    await expect(
      env.DB.prepare("SELECT status FROM store_connections WHERE id = ?1")
        .bind(connectionId)
        .first<Record<string, unknown>>()
    ).resolves.toEqual({ status: "reauthorization_required" });
  });
});

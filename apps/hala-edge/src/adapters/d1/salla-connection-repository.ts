import type { SallaConnectionPort } from "../../modules/salla/salla-connection-port";

export class D1SallaConnectionRepository implements SallaConnectionPort {
  public constructor(private readonly database: D1Database) {}

  public async markAuthorizing(input: {
    organizationId: string;
    updatedAt: string;
  }): Promise<void> {
    await this.database
      .prepare(
        "INSERT INTO store_connections (id, organization_id, provider, status, credential_key_version, created_at, updated_at) VALUES (?1, ?2, 'salla', 'authorizing', 1, ?3, ?3) ON CONFLICT (organization_id, provider) DO UPDATE SET status = 'authorizing', updated_at = excluded.updated_at"
      )
      .bind(crypto.randomUUID(), input.organizationId, input.updatedAt)
      .run();
  }

  public async activateLocalMock(input: {
    organizationId: string;
    externalStoreId: string;
    authorizationScope: string;
    connectedAt: string;
  }): Promise<boolean> {
    const result = await this.database
      .prepare(
        "UPDATE store_connections SET status = 'active', external_store_id = ?2, authorization_scope = ?3, authorization_expires_at = NULL, connected_at = ?4, updated_at = ?4 WHERE organization_id = ?1 AND provider = 'salla' AND status = 'authorizing'"
      )
      .bind(
        input.organizationId,
        input.externalStoreId,
        input.authorizationScope,
        input.connectedAt
      )
      .run();

    return result.meta.changes === 1;
  }
}

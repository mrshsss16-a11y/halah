import type {
  ConsumeSallaOAuthStateOutcome,
  SallaOAuthStatePort,
  SallaOAuthStateRecord
} from "../../modules/salla/salla-oauth-state-port";

function readOrganizationId(row: Record<string, unknown> | null): string | null {
  const organizationId = row?.["organization_id"];
  return typeof organizationId === "string" && organizationId.length > 0 ? organizationId : null;
}

export class D1SallaOAuthStateRepository implements SallaOAuthStatePort {
  public constructor(private readonly database: D1Database) {}

  public async create(record: SallaOAuthStateRecord): Promise<void> {
    await this.database
      .prepare(
        "INSERT INTO salla_oauth_states (id, organization_id, state_hash, expires_at, consumed_at, created_at) VALUES (?1, ?2, ?3, ?4, NULL, ?5)"
      )
      .bind(record.id, record.organizationId, record.stateHash, record.expiresAt, record.createdAt)
      .run();
  }

  public async consume(input: {
    stateHash: string;
    now: string;
  }): Promise<ConsumeSallaOAuthStateOutcome> {
    const accepted = await this.database
      .prepare(
        "UPDATE salla_oauth_states SET consumed_at = ?2 WHERE state_hash = ?1 AND consumed_at IS NULL AND expires_at > ?2 RETURNING organization_id"
      )
      .bind(input.stateHash, input.now)
      .first<Record<string, unknown>>();
    const organizationId = readOrganizationId(accepted);
    if (organizationId !== null) {
      return { kind: "accepted", organizationId };
    }

    const existing = await this.database
      .prepare("SELECT consumed_at FROM salla_oauth_states WHERE state_hash = ?1")
      .bind(input.stateHash)
      .first<Record<string, unknown>>();
    if (existing?.["consumed_at"] !== null && existing?.["consumed_at"] !== undefined) {
      return { kind: "already_consumed" };
    }

    return { kind: "missing_or_expired" };
  }
}

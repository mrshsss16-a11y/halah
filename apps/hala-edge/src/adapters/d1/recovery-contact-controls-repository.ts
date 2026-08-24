import type { RecoveryContactControlsRepositoryPort } from "../../modules/recovery/recovery-contact-controls-port";

export class RecoveryContactControlsRepository implements RecoveryContactControlsRepositoryPort {
  public constructor(private readonly database: D1Database) {}

  public async upsertConsent(input: {
    organizationId: string;
    actorUserId: string;
    update: { contactHash: string; status: "granted" | "withdrawn"; sourceReference: string };
    recordedAt: string;
    requestId: string;
  }): Promise<void> {
    await this.database.batch([
      this.database
        .prepare(
          "INSERT INTO contact_consents (id, organization_id, contact_hash, status, recorded_at, source_reference) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(organization_id, contact_hash) DO UPDATE SET status = excluded.status, recorded_at = excluded.recorded_at, source_reference = excluded.source_reference"
        )
        .bind(
          crypto.randomUUID(),
          input.organizationId,
          input.update.contactHash,
          input.update.status,
          input.recordedAt,
          input.update.sourceReference
        ),
      this.database
        .prepare(
          "INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, reason_code, created_at) VALUES (?1, ?2, ?3, 'recovery_consent_updated', 'contact_consent', ?4, ?5, ?6, ?7)"
        )
        .bind(
          crypto.randomUUID(),
          input.organizationId,
          input.actorUserId,
          input.update.contactHash,
          input.requestId,
          input.update.status,
          input.recordedAt
        )
    ]);
  }

  public async upsertSuppression(input: {
    organizationId: string;
    actorUserId: string;
    update: { contactHash: string; reasonCode: string; expiresAt: string | null };
    createdAt: string;
    requestId: string;
  }): Promise<void> {
    await this.database.batch([
      this.database
        .prepare(
          "INSERT INTO contact_suppressions (id, organization_id, contact_hash, reason_code, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(organization_id, contact_hash) DO UPDATE SET reason_code = excluded.reason_code, created_at = excluded.created_at, expires_at = excluded.expires_at"
        )
        .bind(
          crypto.randomUUID(),
          input.organizationId,
          input.update.contactHash,
          input.update.reasonCode,
          input.createdAt,
          input.update.expiresAt
        ),
      this.database
        .prepare(
          "INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, reason_code, created_at) VALUES (?1, ?2, ?3, 'recovery_contact_suppressed', 'contact_suppression', ?4, ?5, ?6, ?7)"
        )
        .bind(
          crypto.randomUUID(),
          input.organizationId,
          input.actorUserId,
          input.update.contactHash,
          input.requestId,
          input.update.reasonCode,
          input.createdAt
        )
    ]);
  }

  public async removeSuppression(input: {
    organizationId: string;
    actorUserId: string;
    contactHash: string;
    removedAt: string;
    requestId: string;
  }): Promise<"removed" | "missing"> {
    const deleted = await this.database
      .prepare("DELETE FROM contact_suppressions WHERE organization_id = ?1 AND contact_hash = ?2")
      .bind(input.organizationId, input.contactHash)
      .run();
    if (deleted.meta.changes !== 1) {
      return "missing";
    }
    await this.database
      .prepare(
        "INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, reason_code, created_at) VALUES (?1, ?2, ?3, 'recovery_contact_unsuppressed', 'contact_suppression', ?4, ?5, 'local_control_removed', ?6)"
      )
      .bind(
        crypto.randomUUID(),
        input.organizationId,
        input.actorUserId,
        input.contactHash,
        input.requestId,
        input.removedAt
      )
      .run();
    return "removed";
  }
}

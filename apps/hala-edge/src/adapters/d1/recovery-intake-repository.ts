import type {
  RecordRecoveryIntakeOutcome,
  RecoveryIntakePort,
  RecoveryIntakeRecord
} from "../../modules/recovery/recovery-intake-port";

export class D1RecoveryIntakeRepository implements RecoveryIntakePort {
  public constructor(private readonly database: D1Database) {}

  public async record(input: RecoveryIntakeRecord): Promise<RecordRecoveryIntakeOutcome> {
    const results = await this.database.batch([
      this.database
        .prepare(
          "INSERT INTO recovery_cases (id, organization_id, external_cart_id, contact_hash, status, attempt_count, policy_source_id, policy_version, reason_code, next_action_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'received', 0, NULL, NULL, 'received', NULL, ?5, ?5) ON CONFLICT (organization_id, external_cart_id) DO NOTHING"
        )
        .bind(
          input.id,
          input.organizationId,
          input.externalCartId,
          input.contactHash,
          input.createdAt
        ),
      this.database
        .prepare(
          "INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, reason_code, created_at) SELECT ?1, ?2, NULL, 'recovery_case_received', 'recovery_case', ?3, ?4, 'received', ?5 WHERE changes() = 1"
        )
        .bind(input.auditEventId, input.organizationId, input.id, input.requestId, input.createdAt)
    ]);

    if (results[0]?.meta.changes === 1) {
      return { kind: "recorded", recoveryCaseId: input.id };
    }

    return { kind: "duplicate" };
  }
}

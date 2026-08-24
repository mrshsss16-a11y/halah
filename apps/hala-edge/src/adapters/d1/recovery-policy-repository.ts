import type { RecoveryPolicyDraftInput, RecoveryPolicyRecord } from "@hala/contracts";
import type { RecoveryPolicyRepositoryPort } from "../../modules/recovery/recovery-policy-port";

function toPolicyRecord(row: Record<string, unknown>): RecoveryPolicyRecord | null {
  const id = row["id"];
  const version = row["policy_version"];
  const status = row["status"];
  const effectiveFrom = row["effective_from"];
  const effectiveUntil = row["effective_until"];
  const policyJson = row["policy_json"];
  const createdAt = row["created_at"];
  const approvedAt = row["approved_at"];
  if (
    typeof id !== "string" ||
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    (status !== "active" && status !== "inactive" && status !== "retired") ||
    typeof effectiveFrom !== "string" ||
    (effectiveUntil !== null && typeof effectiveUntil !== "string") ||
    typeof policyJson !== "string" ||
    typeof createdAt !== "string" ||
    (approvedAt !== null && typeof approvedAt !== "string")
  ) {
    return null;
  }
  try {
    const candidate: unknown = JSON.parse(policyJson);
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      return null;
    }
    const policy = candidate as Record<string, unknown>;
    if (
      typeof policy["allowsRecovery"] !== "boolean" ||
      typeof policy["maxAttemptsPerCase"] !== "number" ||
      typeof policy["maxMessagesPerContactWindow"] !== "number" ||
      typeof policy["replyBudgetPerCase"] !== "number"
    ) {
      return null;
    }
    return Object.freeze({
      id,
      version,
      status,
      effectiveFrom,
      effectiveUntil,
      policy: Object.freeze({
        allowsRecovery: policy["allowsRecovery"],
        maxAttemptsPerCase: policy["maxAttemptsPerCase"],
        maxMessagesPerContactWindow: policy["maxMessagesPerContactWindow"],
        replyBudgetPerCase: policy["replyBudgetPerCase"]
      }),
      createdAt,
      approvedAt
    });
  } catch {
    return null;
  }
}

export class RecoveryPolicyRepository implements RecoveryPolicyRepositoryPort {
  public constructor(private readonly database: D1Database) {}

  public async list(organizationId: string): Promise<readonly RecoveryPolicyRecord[]> {
    const result = await this.database
      .prepare(
        "SELECT id, policy_version, status, effective_from, effective_until, policy_json, created_at, approved_at FROM policy_sources WHERE organization_id = ?1 ORDER BY policy_version DESC"
      )
      .bind(organizationId)
      .all<Record<string, unknown>>();
    const policies: RecoveryPolicyRecord[] = [];
    for (const row of result.results) {
      const policy = toPolicyRecord(row);
      if (policy !== null) {
        policies.push(policy);
      }
    }
    return Object.freeze(policies);
  }

  public async createDraft(input: {
    id: string;
    organizationId: string;
    policy: RecoveryPolicyDraftInput;
    contentHash: string;
    createdByUserId: string;
    createdAt: string;
  }): Promise<RecoveryPolicyRecord> {
    const policyJson = JSON.stringify(input.policy);
    await this.database
      .prepare(
        "INSERT INTO policy_sources (id, organization_id, status, effective_from, effective_until, policy_version, content_hash, created_at, updated_at, policy_json, created_by_user_id, approved_by_user_id, approved_at) SELECT ?1, ?2, 'inactive', ?3, NULL, COALESCE(MAX(policy_version), 0) + 1, ?4, ?3, ?3, ?5, ?6, NULL, NULL FROM policy_sources WHERE organization_id = ?2"
      )
      .bind(
        input.id,
        input.organizationId,
        input.createdAt,
        input.contentHash,
        policyJson,
        input.createdByUserId
      )
      .run();
    const created = await this.database
      .prepare(
        "SELECT id, policy_version, status, effective_from, effective_until, policy_json, created_at, approved_at FROM policy_sources WHERE id = ?1 AND organization_id = ?2"
      )
      .bind(input.id, input.organizationId)
      .first<Record<string, unknown>>();
    const policy = created === null ? null : toPolicyRecord(created);
    if (policy === null) {
      throw new Error("recovery_policy_create_failed");
    }
    return policy;
  }

  public async activate(input: {
    organizationId: string;
    policyId: string;
    approvedByUserId: string;
    approvedAt: string;
    requestId: string;
  }): Promise<"activated" | "missing" | "not_draft"> {
    const candidate = await this.database
      .prepare("SELECT status FROM policy_sources WHERE id = ?1 AND organization_id = ?2")
      .bind(input.policyId, input.organizationId)
      .first<Record<string, unknown>>();
    if (candidate === null) {
      return "missing";
    }
    if (candidate["status"] !== "inactive") {
      return "not_draft";
    }
    await this.database.batch([
      this.database
        .prepare(
          "UPDATE policy_sources SET status = 'retired', effective_until = ?2, updated_at = ?2 WHERE organization_id = ?1 AND status = 'active'"
        )
        .bind(input.organizationId, input.approvedAt),
      this.database
        .prepare(
          "UPDATE policy_sources SET status = 'active', approved_by_user_id = ?3, approved_at = ?4, updated_at = ?4 WHERE id = ?1 AND organization_id = ?2 AND status = 'inactive'"
        )
        .bind(input.policyId, input.organizationId, input.approvedByUserId, input.approvedAt),
      this.database
        .prepare(
          "INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, reason_code, created_at) VALUES (?1, ?2, ?3, 'recovery_policy_activated', 'policy_source', ?4, ?5, 'approval_gate_local_only', ?6)"
        )
        .bind(
          crypto.randomUUID(),
          input.organizationId,
          input.approvedByUserId,
          input.policyId,
          input.requestId,
          input.approvedAt
        )
    ]);
    return "activated";
  }
}

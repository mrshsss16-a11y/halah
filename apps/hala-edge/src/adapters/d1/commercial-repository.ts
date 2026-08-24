import type {
  ActivationRequestStatus,
  ActivationService,
  CommercialDashboard
} from "@hala/contracts";

const activationStatuses = new Set<ActivationRequestStatus>([
  "submitted",
  "reviewing",
  "approved",
  "declined",
  "cancelled"
]);

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstResultRow(
  result: Readonly<{ results: ReadonlyArray<unknown> }> | null | undefined
): Record<string, unknown> | null {
  if (result === null || result === undefined) {
    return null;
  }
  return toRecord(result.results[0] ?? null);
}

function readConnectionStatus(
  row: Record<string, unknown> | null
): CommercialDashboard["connectionStatus"] {
  if (row === null) {
    return "not_connected";
  }
  const status = row["status"];
  if (status === "active") {
    return "active";
  }
  return "pending";
}

function readProductContentStatus(
  row: Record<string, unknown> | null
): CommercialDashboard["productContentStatus"] {
  if (row === null) {
    return "not_started";
  }
  const status = row["status"];
  if (status === "ready_for_generation") {
    return "ready_for_review";
  }
  return "needs_evidence";
}

function readRecoveryStatus(
  row: Record<string, unknown> | null
): CommercialDashboard["recoveryStatus"] {
  if (row === null) {
    return "not_configured";
  }
  const status = row["status"];
  return status === "active" ? "ready_for_staging" : "policy_review";
}

function readActivationStatus(row: Record<string, unknown> | null): ActivationRequestStatus | null {
  if (row === null) {
    return null;
  }
  const status = row["status"];
  return typeof status === "string" && activationStatuses.has(status as ActivationRequestStatus)
    ? (status as ActivationRequestStatus)
    : null;
}

export class CommercialRepository {
  public constructor(private readonly database: D1Database) {}

  public async loadDashboard(input: {
    organizationId: string;
    organizationName: string;
  }): Promise<CommercialDashboard> {
    const [connection, productImport, policy, activation] = await this.database.batch([
      this.database
        .prepare(
          "SELECT status FROM store_connections WHERE organization_id = ?1 AND provider = 'salla' LIMIT 1"
        )
        .bind(input.organizationId),
      this.database
        .prepare(
          "SELECT status FROM product_content_imports WHERE organization_id = ?1 ORDER BY created_at DESC LIMIT 1"
        )
        .bind(input.organizationId),
      this.database
        .prepare(
          "SELECT status FROM policy_sources WHERE organization_id = ?1 ORDER BY updated_at DESC LIMIT 1"
        )
        .bind(input.organizationId),
      this.database
        .prepare(
          "SELECT status FROM activation_requests WHERE organization_id = ?1 ORDER BY created_at DESC LIMIT 1"
        )
        .bind(input.organizationId)
    ]);

    return Object.freeze({
      organizationName: input.organizationName,
      connectionStatus: readConnectionStatus(firstResultRow(connection)),
      productContentStatus: readProductContentStatus(firstResultRow(productImport)),
      recoveryStatus: readRecoveryStatus(firstResultRow(policy)),
      activationStatus: readActivationStatus(firstResultRow(activation))
    });
  }

  public async submitActivationRequest(input: {
    id: string;
    organizationId: string;
    userId: string;
    requestedService: ActivationService;
    notes: string;
    createdAt: string;
  }): Promise<void> {
    await this.database
      .prepare(
        "INSERT INTO activation_requests (id, organization_id, requested_by_user_id, requested_service, status, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'submitted', ?5, ?6, ?6)"
      )
      .bind(
        input.id,
        input.organizationId,
        input.userId,
        input.requestedService,
        input.notes,
        input.createdAt
      )
      .run();
  }
}

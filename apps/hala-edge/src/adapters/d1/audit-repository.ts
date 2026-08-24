import type { AuditEventListItem, AuditEventQuery } from "@hala/contracts";

function toAuditEventListItem(row: Record<string, unknown>): AuditEventListItem | null {
  const id = row["id"];
  const action = row["action"];
  const entityType = row["entity_type"];
  const entityId = row["entity_id"];
  const requestId = row["request_id"];
  const reasonCode = row["reason_code"];
  const createdAt = row["created_at"];
  if (
    typeof id !== "string" ||
    typeof action !== "string" ||
    typeof entityType !== "string" ||
    typeof entityId !== "string" ||
    typeof requestId !== "string" ||
    (reasonCode !== null && typeof reasonCode !== "string") ||
    typeof createdAt !== "string"
  ) {
    return null;
  }

  return Object.freeze({ id, action, entityType, entityId, requestId, reasonCode, createdAt });
}

export class AuditRepository {
  public constructor(private readonly database: D1Database) {}

  public async listOrganizationEvents(
    organizationId: string,
    query: AuditEventQuery
  ): Promise<Readonly<{ items: readonly AuditEventListItem[]; total: number }>> {
    const offset = (query.page - 1) * query.pageSize;
    const where =
      query.action === undefined ? "organization_id = ?1" : "organization_id = ?1 AND action = ?2";
    const bindings: readonly unknown[] =
      query.action === undefined ? [organizationId] : [organizationId, query.action];
    const countQuery = this.database.prepare(
      `SELECT COUNT(*) AS total FROM audit_events WHERE ${where}`
    );
    const itemQuery = this.database.prepare(
      `SELECT id, action, entity_type, entity_id, request_id, reason_code, created_at FROM audit_events WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?${bindings.length + 1} OFFSET ?${bindings.length + 2}`
    );
    const [count, rows] = await this.database.batch([
      countQuery.bind(...bindings),
      itemQuery.bind(...bindings, query.pageSize, offset)
    ]);
    if (count === undefined || rows === undefined) {
      return Object.freeze({ items: Object.freeze([]), total: 0 });
    }
    const countRow = count.results[0] as Record<string, unknown> | undefined;
    const total = typeof countRow?.["total"] === "number" ? countRow["total"] : 0;
    const items: AuditEventListItem[] = [];
    for (const candidate of rows.results) {
      if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
        continue;
      }
      const item = toAuditEventListItem(candidate as Record<string, unknown>);
      if (item !== null) {
        items.push(item);
      }
    }

    return Object.freeze({ items: Object.freeze(items), total });
  }
}

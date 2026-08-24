import type {
  CreateProductContentImport,
  ProductContentRepositoryPort
} from "../../modules/product-content/product-content-port";
import type {
  ApprovedProductFact,
  ApprovedProductFactSummary,
  CreateProductContentDraft,
  ProductContentDraftRepositoryPort
} from "../../modules/product-content/product-content-draft-port";
import type {
  CreateProductContentExportStage,
  ProductContentExportStageRepositoryPort
} from "../../modules/product-content/product-content-export-stage-port";
import type {
  ProductContentDraftReviewItem,
  ProductContentDraftReviewRepositoryPort,
  ProductContentPreviewItem,
  ReviewProductContentDraft
} from "../../modules/product-content/product-content-draft-review-port";
import type {
  ApproveProductFactEvidence,
  ProductContentReviewRepositoryPort,
  ProductFactReviewItem
} from "../../modules/product-content/product-content-review-port";

function toProductFactReviewItem(row: Record<string, unknown>): ProductFactReviewItem | null {
  const id = row["id"];
  const productImportId = row["product_import_id"];
  const productReference = row["product_reference"];
  const sku = row["sku"];
  const category = row["category"];
  const factsJson = row["facts_json"];
  const evidenceStatus = row["evidence_status"];
  const evidenceReviewNote = row["evidence_review_note"];
  if (
    typeof id !== "string" ||
    typeof productImportId !== "string" ||
    typeof productReference !== "string" ||
    typeof sku !== "string" ||
    typeof category !== "string" ||
    typeof factsJson !== "string" ||
    (evidenceStatus !== "needs_evidence" && evidenceStatus !== "approved") ||
    typeof evidenceReviewNote !== "string"
  ) {
    return null;
  }

  return Object.freeze({
    id,
    productImportId,
    productReference,
    sku,
    category,
    factsJson,
    evidenceStatus,
    evidenceReviewNote
  });
}

export class ProductContentRepository
  implements
    ProductContentRepositoryPort,
    ProductContentReviewRepositoryPort,
    ProductContentDraftRepositoryPort,
    ProductContentDraftReviewRepositoryPort,
    ProductContentExportStageRepositoryPort
{
  public constructor(private readonly database: D1Database) {}

  public async findExistingSkus(
    organizationId: string,
    skus: readonly string[]
  ): Promise<readonly string[]> {
    if (skus.length === 0) {
      return Object.freeze([]);
    }

    const placeholders = skus.map((_, index) => `?${index + 2}`).join(", ");
    const result = await this.database
      .prepare(
        `SELECT sku FROM product_fact_sets WHERE organization_id = ?1 AND sku IN (${placeholders}) ORDER BY sku ASC`
      )
      .bind(organizationId, ...skus)
      .all<Record<string, unknown>>();
    const existingSkus: string[] = [];
    for (const row of result.results) {
      const sku = row["sku"];
      if (typeof sku === "string") {
        existingSkus.push(sku);
      }
    }

    return Object.freeze(existingSkus);
  }

  public async createImportWithFacts(input: CreateProductContentImport): Promise<void> {
    const statements: D1PreparedStatement[] = [
      this.database
        .prepare(
          "INSERT INTO product_content_imports (id, organization_id, source_name, record_count, status, created_by_user_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)"
        )
        .bind(
          input.id,
          input.organizationId,
          input.sourceName,
          input.facts.length,
          input.status,
          input.createdByUserId,
          input.createdAt
        )
    ];

    for (const fact of input.facts) {
      statements.push(
        this.database
          .prepare(
            "INSERT INTO product_fact_sets (id, organization_id, product_import_id, product_reference, sku, category, facts_json, evidence_status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)"
          )
          .bind(
            fact.id,
            input.organizationId,
            input.id,
            fact.productReference,
            fact.sku,
            fact.category,
            fact.factsJson,
            fact.evidenceStatus,
            input.createdAt
          )
      );
    }

    await this.database.batch(statements);
  }

  public async listEvidenceReviewItems(
    organizationId: string
  ): Promise<readonly ProductFactReviewItem[]> {
    const result = await this.database
      .prepare(
        "SELECT id, product_import_id, product_reference, sku, category, facts_json, evidence_status, evidence_review_note FROM product_fact_sets WHERE organization_id = ?1 AND evidence_status = 'needs_evidence' ORDER BY updated_at ASC, sku ASC"
      )
      .bind(organizationId)
      .all<Record<string, unknown>>();
    const items: ProductFactReviewItem[] = [];
    for (const row of result.results) {
      const item = toProductFactReviewItem(row);
      if (item !== null) {
        items.push(item);
      }
    }

    return Object.freeze(items);
  }

  public async listPreviewItems(
    organizationId: string
  ): Promise<readonly ProductContentPreviewItem[]> {
    const result = await this.database
      .prepare(
        "SELECT d.id, f.sku, f.product_reference, d.title, d.short_description, d.long_description, d.meta_description, d.evidence_map_json FROM product_content_drafts d JOIN product_fact_sets f ON f.id = d.product_fact_set_id AND f.organization_id = d.organization_id WHERE d.organization_id = ?1 AND d.status = 'approved_for_preview' ORDER BY d.reviewed_at DESC, d.id ASC"
      )
      .bind(organizationId)
      .all<Record<string, unknown>>();
    const items: ProductContentPreviewItem[] = [];
    for (const row of result.results) {
      const id = row["id"];
      const sku = row["sku"];
      const productReference = row["product_reference"];
      const title = row["title"];
      const shortDescription = row["short_description"];
      const longDescription = row["long_description"];
      const metaDescription = row["meta_description"];
      const evidenceMapJson = row["evidence_map_json"];
      if (
        typeof id === "string" &&
        typeof sku === "string" &&
        typeof productReference === "string" &&
        typeof title === "string" &&
        typeof shortDescription === "string" &&
        typeof longDescription === "string" &&
        typeof metaDescription === "string" &&
        typeof evidenceMapJson === "string"
      ) {
        items.push(
          Object.freeze({
            id,
            sku,
            productReference,
            title,
            shortDescription,
            longDescription,
            metaDescription,
            evidenceMapJson
          })
        );
      }
    }

    return Object.freeze(items);
  }

  public async createExportStage(
    input: CreateProductContentExportStage
  ): Promise<
    Readonly<{ kind: "staged"; itemCount: number }> | Readonly<{ kind: "drafts_not_available" }>
  > {
    if (new Set(input.draftIds).size !== input.draftIds.length) {
      return Object.freeze({ kind: "drafts_not_available" });
    }

    const placeholders = input.draftIds.map((_, index) => `?${index + 2}`).join(", ");
    const result = await this.database
      .prepare(
        `SELECT d.id, f.sku, f.product_reference, d.title, d.short_description, d.long_description, d.meta_description, d.evidence_map_json FROM product_content_drafts d JOIN product_fact_sets f ON f.id = d.product_fact_set_id AND f.organization_id = d.organization_id WHERE d.organization_id = ?1 AND d.status = 'approved_for_preview' AND d.id IN (${placeholders})`
      )
      .bind(input.organizationId, ...input.draftIds)
      .all<Record<string, unknown>>();
    if (result.results.length !== input.draftIds.length) {
      return Object.freeze({ kind: "drafts_not_available" });
    }

    const sourceByDraftId = new Map<string, Record<string, unknown>>();
    for (const row of result.results) {
      const id = row["id"];
      const sku = row["sku"];
      const productReference = row["product_reference"];
      const title = row["title"];
      const shortDescription = row["short_description"];
      const longDescription = row["long_description"];
      const metaDescription = row["meta_description"];
      const evidenceMapJson = row["evidence_map_json"];
      if (
        typeof id !== "string" ||
        typeof sku !== "string" ||
        typeof productReference !== "string" ||
        typeof title !== "string" ||
        typeof shortDescription !== "string" ||
        typeof longDescription !== "string" ||
        typeof metaDescription !== "string" ||
        typeof evidenceMapJson !== "string"
      ) {
        return Object.freeze({ kind: "drafts_not_available" });
      }
      sourceByDraftId.set(id, row);
    }
    if (sourceByDraftId.size !== input.draftIds.length) {
      return Object.freeze({ kind: "drafts_not_available" });
    }

    const statements: D1PreparedStatement[] = [
      this.database
        .prepare(
          "INSERT INTO product_content_export_stages (id, organization_id, format, status, item_count, created_by_user_id, created_at) VALUES (?1, ?2, 'csv_review', 'staged', ?3, ?4, ?5)"
        )
        .bind(
          input.exportStageId,
          input.organizationId,
          input.draftIds.length,
          input.userId,
          input.createdAt
        )
    ];
    for (const draftId of input.draftIds) {
      const source = sourceByDraftId.get(draftId);
      if (source === undefined) {
        return Object.freeze({ kind: "drafts_not_available" });
      }
      const sku = source["sku"];
      const productReference = source["product_reference"];
      if (typeof sku !== "string" || typeof productReference !== "string") {
        return Object.freeze({ kind: "drafts_not_available" });
      }
      const snapshotJson = JSON.stringify({
        version: 1,
        draftId,
        sku,
        productReference,
        title: source["title"],
        shortDescription: source["short_description"],
        longDescription: source["long_description"],
        metaDescription: source["meta_description"],
        evidenceMapJson: source["evidence_map_json"]
      });
      statements.push(
        this.database
          .prepare(
            "INSERT INTO product_content_export_stage_items (export_stage_id, organization_id, draft_id, sku, product_reference, snapshot_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
          )
          .bind(
            input.exportStageId,
            input.organizationId,
            draftId,
            sku,
            productReference,
            snapshotJson,
            input.createdAt
          )
      );
    }
    statements.push(
      this.database
        .prepare(
          "INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, reason_code, created_at) VALUES (?1, ?2, ?3, 'product_content_export_staged', 'product_content_export_stage', ?4, ?5, 'csv_review_local_only', ?6)"
        )
        .bind(
          input.auditEventId,
          input.organizationId,
          input.userId,
          input.exportStageId,
          input.requestId,
          input.createdAt
        )
    );
    await this.database.batch(statements);

    return Object.freeze({ kind: "staged", itemCount: input.draftIds.length });
  }

  public async listDraftReviewItems(
    organizationId: string
  ): Promise<readonly ProductContentDraftReviewItem[]> {
    const result = await this.database
      .prepare(
        "SELECT id, product_fact_set_id, title, short_description, long_description, meta_description, evidence_map_json FROM product_content_drafts WHERE organization_id = ?1 AND status = 'ready_for_review' ORDER BY updated_at ASC, id ASC"
      )
      .bind(organizationId)
      .all<Record<string, unknown>>();
    const drafts: ProductContentDraftReviewItem[] = [];
    for (const row of result.results) {
      const id = row["id"];
      const productFactSetId = row["product_fact_set_id"];
      const title = row["title"];
      const shortDescription = row["short_description"];
      const longDescription = row["long_description"];
      const metaDescription = row["meta_description"];
      const evidenceMapJson = row["evidence_map_json"];
      if (
        typeof id === "string" &&
        typeof productFactSetId === "string" &&
        typeof title === "string" &&
        typeof shortDescription === "string" &&
        typeof longDescription === "string" &&
        typeof metaDescription === "string" &&
        typeof evidenceMapJson === "string"
      ) {
        drafts.push(
          Object.freeze({
            id,
            productFactSetId,
            title,
            shortDescription,
            longDescription,
            metaDescription,
            evidenceMapJson
          })
        );
      }
    }

    return Object.freeze(drafts);
  }

  public async reviewDraft(input: ReviewProductContentDraft): Promise<boolean> {
    const nextStatus = input.decision === "approve" ? "approved_for_preview" : "rejected";
    const update = await this.database
      .prepare(
        "UPDATE product_content_drafts SET status = ?3, reviewed_by_user_id = ?4, reviewed_at = ?5, review_note = ?6, updated_at = ?5 WHERE id = ?1 AND organization_id = ?2 AND status = 'ready_for_review'"
      )
      .bind(
        input.draftId,
        input.organizationId,
        nextStatus,
        input.userId,
        input.reviewedAt,
        input.reviewNote
      )
      .run();
    if (update.meta.changes !== 1) {
      return false;
    }

    await this.database
      .prepare(
        "INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, reason_code, created_at) VALUES (?1, ?2, ?3, ?4, 'product_content_draft', ?5, ?6, ?7, ?8)"
      )
      .bind(
        input.auditEventId,
        input.organizationId,
        input.userId,
        input.decision === "approve"
          ? "product_content_draft_approved_for_preview"
          : "product_content_draft_rejected",
        input.draftId,
        input.requestId,
        input.reviewNote,
        input.reviewedAt
      )
      .run();
    return true;
  }

  public async listApprovedFacts(
    organizationId: string
  ): Promise<readonly ApprovedProductFactSummary[]> {
    const result = await this.database
      .prepare(
        "SELECT id, product_reference, sku, category, facts_json FROM product_fact_sets WHERE organization_id = ?1 AND evidence_status = 'approved' ORDER BY updated_at DESC, sku ASC"
      )
      .bind(organizationId)
      .all<Record<string, unknown>>();
    const facts: ApprovedProductFactSummary[] = [];
    for (const row of result.results) {
      const id = row["id"];
      const productReference = row["product_reference"];
      const sku = row["sku"];
      const category = row["category"];
      const factsJson = row["facts_json"];
      if (
        typeof id === "string" &&
        typeof productReference === "string" &&
        typeof sku === "string" &&
        typeof category === "string" &&
        typeof factsJson === "string"
      ) {
        facts.push(Object.freeze({ id, productReference, sku, category, factsJson }));
      }
    }

    return Object.freeze(facts);
  }

  public async findApprovedFact(
    organizationId: string,
    factId: string
  ): Promise<ApprovedProductFact | null> {
    const row = await this.database
      .prepare(
        "SELECT id, facts_json FROM product_fact_sets WHERE id = ?1 AND organization_id = ?2 AND evidence_status = 'approved'"
      )
      .bind(factId, organizationId)
      .first<Record<string, unknown>>();
    const id = row?.["id"];
    const factsJson = row?.["facts_json"];
    return typeof id === "string" && typeof factsJson === "string"
      ? Object.freeze({ id, factsJson })
      : null;
  }

  public async createDraft(input: CreateProductContentDraft): Promise<void> {
    await this.database.batch([
      this.database
        .prepare(
          "INSERT INTO product_content_drafts (id, organization_id, product_fact_set_id, title, short_description, long_description, meta_description, evidence_map_json, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)"
        )
        .bind(
          input.id,
          input.organizationId,
          input.productFactSetId,
          input.title,
          input.shortDescription,
          input.longDescription,
          input.metaDescription,
          input.evidenceMapJson,
          input.status,
          input.createdAt
        ),
      this.database
        .prepare(
          "INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, reason_code, created_at) VALUES (?1, ?2, ?3, 'product_content_draft_created', 'product_content_draft', ?4, ?5, ?6, ?7)"
        )
        .bind(
          input.auditEventId,
          input.organizationId,
          input.createdByUserId,
          input.id,
          input.requestId,
          input.status,
          input.createdAt
        )
    ]);
  }

  public async approveEvidence(input: ApproveProductFactEvidence): Promise<boolean> {
    const fact = await this.database
      .prepare(
        "SELECT product_import_id FROM product_fact_sets WHERE id = ?1 AND organization_id = ?2 AND evidence_status = 'needs_evidence'"
      )
      .bind(input.factId, input.organizationId)
      .first<Record<string, unknown>>();
    const productImportId = fact?.["product_import_id"];
    if (typeof productImportId !== "string") {
      return false;
    }

    await this.database.batch([
      this.database
        .prepare(
          "UPDATE product_fact_sets SET evidence_status = 'approved', evidence_reviewed_by_user_id = ?3, evidence_reviewed_at = ?4, evidence_review_note = ?5, updated_at = ?4 WHERE id = ?1 AND organization_id = ?2 AND evidence_status = 'needs_evidence'"
        )
        .bind(input.factId, input.organizationId, input.userId, input.reviewedAt, input.reviewNote),
      this.database
        .prepare(
          "UPDATE product_content_imports SET status = CASE WHEN NOT EXISTS (SELECT 1 FROM product_fact_sets WHERE product_import_id = ?1 AND organization_id = ?2 AND evidence_status = 'needs_evidence') THEN 'ready_for_generation' ELSE 'needs_evidence' END, updated_at = ?3 WHERE id = ?1 AND organization_id = ?2"
        )
        .bind(productImportId, input.organizationId, input.reviewedAt),
      this.database
        .prepare(
          "INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, reason_code, created_at) VALUES (?1, ?2, ?3, 'product_fact_evidence_approved', 'product_fact_set', ?4, ?5, 'manual_evidence_review', ?6)"
        )
        .bind(
          input.auditEventId,
          input.organizationId,
          input.userId,
          input.factId,
          input.requestId,
          input.reviewedAt
        )
    ]);

    return true;
  }
}

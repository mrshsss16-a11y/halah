import type { ProductContentImportInput } from "@hala/contracts";
import { validateProductCsv, type ProductImportIssue } from "./csv-import";
import type { ProductContentRepositoryPort } from "./product-content-port";

export type SubmitProductImportInput = Readonly<{
  organizationId: string;
  userId: string;
  sourceName: ProductContentImportInput["sourceName"];
  csvText: ProductContentImportInput["csvText"];
}>;

export type SubmitProductImportOutcome =
  | Readonly<{
      kind: "rejected";
      recordCount: number;
      errors: readonly ProductImportIssue[];
      warnings: readonly ProductImportIssue[];
    }>
  | Readonly<{
      kind: "stored";
      importId: string;
      status: "needs_evidence" | "ready_for_generation";
      recordCount: number;
      warnings: readonly ProductImportIssue[];
    }>;

export class ProductContentImportService {
  public constructor(
    private readonly repository: ProductContentRepositoryPort,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID()
  ) {}

  public async submit(input: SubmitProductImportInput): Promise<SubmitProductImportOutcome> {
    const validation = validateProductCsv(input.csvText);
    if (validation.status === "failed") {
      return Object.freeze({
        kind: "rejected",
        recordCount: validation.recordCount,
        errors: validation.errors,
        warnings: validation.warnings
      });
    }

    const existingSkus = new Set(
      await this.repository.findExistingSkus(
        input.organizationId,
        validation.facts.map((fact) => fact.sku)
      )
    );
    const existingSkuErrors = validation.facts
      .filter((fact) => existingSkus.has(fact.sku))
      .map((fact) =>
        Object.freeze({
          line: fact.line,
          code: "sku_already_imported" as const,
          field: "sku",
          message: "SKU موجود مسبقاً في مساحة متجرك؛ راجعه أو استخدم مسار تحديث مقيد."
        })
      );
    if (existingSkuErrors.length > 0) {
      return Object.freeze({
        kind: "rejected",
        recordCount: validation.recordCount,
        errors: Object.freeze(existingSkuErrors),
        warnings: validation.warnings
      });
    }

    const storedStatus = validation.status;
    if (storedStatus !== "needs_evidence" && storedStatus !== "ready_for_generation") {
      throw new Error("Validated product import returned an unsupported persistence status.");
    }

    const importId = this.createId();
    const createdAt = this.clock().toISOString();
    await this.repository.createImportWithFacts({
      id: importId,
      organizationId: input.organizationId,
      sourceName: input.sourceName,
      status: storedStatus,
      createdByUserId: input.userId,
      createdAt,
      facts: validation.facts.map((fact) =>
        Object.freeze({
          id: this.createId(),
          productReference: fact.productReference,
          sku: fact.sku,
          category: fact.category,
          factsJson: fact.factsJson,
          evidenceStatus: fact.evidenceStatus
        })
      )
    });

    return Object.freeze({
      kind: "stored",
      importId,
      status: storedStatus,
      recordCount: validation.recordCount,
      warnings: validation.warnings
    });
  }
}

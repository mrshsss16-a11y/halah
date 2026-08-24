import type { ProductContentImportStatus } from "@hala/contracts";
import type { ValidatedProductFact } from "./csv-import";

export type CreateProductContentImport = Readonly<{
  id: string;
  organizationId: string;
  sourceName: string;
  status: ProductContentImportStatus;
  createdByUserId: string;
  createdAt: string;
  facts: readonly Readonly<{
    id: string;
    productReference: string;
    sku: string;
    category: string;
    factsJson: string;
    evidenceStatus: ValidatedProductFact["evidenceStatus"];
  }>[];
}>;

export interface ProductContentRepositoryPort {
  findExistingSkus(organizationId: string, skus: readonly string[]): Promise<readonly string[]>;
  createImportWithFacts(input: CreateProductContentImport): Promise<void>;
}

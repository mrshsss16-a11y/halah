import { describe, expect, it } from "vitest";
import type {
  CreateProductContentImport,
  ProductContentRepositoryPort
} from "../../src/modules/product-content/product-content-port";
import { ProductContentImportService } from "../../src/modules/product-content/product-content-import-service";

const header = "product_ref,sku,product_name_ar,category,facts_json,source_url";
const validRow =
  'product-1,SKU-1,عطر اختبار,عطور,"{""volume_ml"":100}",https://merchant.example.test/products/product-1';

class FakeProductContentRepository implements ProductContentRepositoryPort {
  public readonly imports: CreateProductContentImport[] = [];
  public existingSkus: readonly string[] = [];

  public async findExistingSkus(
    _organizationId: string,
    skus: readonly string[]
  ): Promise<readonly string[]> {
    return this.existingSkus.filter((sku) => skus.includes(sku));
  }

  public async createImportWithFacts(input: CreateProductContentImport): Promise<void> {
    this.imports.push(input);
  }
}

function sequentialIds(): () => string {
  const ids = ["import-1", "fact-1", "fact-2"];
  return () => {
    const nextId = ids.shift();
    if (nextId === undefined) {
      throw new Error("Test ID sequence exhausted.");
    }
    return nextId;
  };
}

describe("ProductContentImportService", () => {
  it("stores a validated import with organization-scoped facts", async () => {
    const repository = new FakeProductContentRepository();
    const service = new ProductContentImportService(
      repository,
      () => new Date("2026-08-23T10:00:00.000Z"),
      sequentialIds()
    );

    const outcome = await service.submit({
      organizationId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      sourceName: "sample-products.csv",
      csvText: `${header}\n${validRow}`
    });

    expect(outcome).toEqual(
      expect.objectContaining({
        kind: "stored",
        importId: "import-1",
        status: "needs_evidence",
        recordCount: 1
      })
    );
    expect(repository.imports).toEqual([
      expect.objectContaining({
        id: "import-1",
        organizationId: "11111111-1111-4111-8111-111111111111",
        createdByUserId: "22222222-2222-4222-8222-222222222222",
        status: "needs_evidence",
        facts: [
          expect.objectContaining({
            id: "fact-1",
            sku: "SKU-1",
            evidenceStatus: "needs_evidence"
          })
        ]
      })
    ]);
  });

  it("returns reportable errors without persistence when the import is invalid", async () => {
    const repository = new FakeProductContentRepository();
    const service = new ProductContentImportService(repository);

    const outcome = await service.submit({
      organizationId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      sourceName: "invalid-products.csv",
      csvText: `${header}\n${validRow}\n${validRow}`
    });

    expect(outcome).toEqual(
      expect.objectContaining({
        kind: "rejected",
        errors: [expect.objectContaining({ code: "duplicate_sku" })]
      })
    );
    expect(repository.imports).toEqual([]);
  });

  it("rejects a SKU that already belongs to the same organization", async () => {
    const repository = new FakeProductContentRepository();
    repository.existingSkus = ["SKU-1"];
    const service = new ProductContentImportService(repository);

    const outcome = await service.submit({
      organizationId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      sourceName: "duplicate-existing.csv",
      csvText: `${header}\n${validRow}`
    });

    expect(outcome).toEqual(
      expect.objectContaining({
        kind: "rejected",
        errors: [expect.objectContaining({ code: "sku_already_imported", line: 2 })]
      })
    );
    expect(repository.imports).toEqual([]);
  });

  it("stores valid rows as needs_evidence when no approved source accompanies their facts", async () => {
    const repository = new FakeProductContentRepository();
    const service = new ProductContentImportService(
      repository,
      () => new Date("2026-08-23T10:00:00.000Z"),
      sequentialIds()
    );

    const outcome = await service.submit({
      organizationId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      sourceName: "needs-evidence.csv",
      csvText: `${header}\nproduct-1,SKU-1,عطر اختبار,عطور,"{""volume_ml"":100}",`
    });

    expect(outcome).toEqual(expect.objectContaining({ kind: "stored", status: "needs_evidence" }));
    expect(repository.imports[0]).toEqual(
      expect.objectContaining({
        facts: [expect.objectContaining({ evidenceStatus: "needs_evidence" })]
      })
    );
  });
});

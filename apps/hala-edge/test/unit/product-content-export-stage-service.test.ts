import { describe, expect, it } from "vitest";
import type {
  CreateProductContentExportStage,
  ProductContentExportStageRepositoryPort
} from "../../src/modules/product-content/product-content-export-stage-port";
import { ProductContentExportStageService } from "../../src/modules/product-content/product-content-export-stage-service";

class FakeExportStageRepository implements ProductContentExportStageRepositoryPort {
  public command: CreateProductContentExportStage | null = null;
  public outcome: Awaited<
    ReturnType<ProductContentExportStageRepositoryPort["createExportStage"]>
  > = {
    kind: "staged",
    itemCount: 1
  };

  public async createExportStage(
    input: CreateProductContentExportStage
  ): Promise<Awaited<ReturnType<ProductContentExportStageRepositoryPort["createExportStage"]>>> {
    this.command = input;
    return this.outcome;
  }
}

describe("ProductContentExportStageService", () => {
  it("creates an audited staging command for approved draft IDs", async () => {
    const repository = new FakeExportStageRepository();
    const ids = ["stage-1", "audit-1"];
    const service = new ProductContentExportStageService(
      repository,
      () => new Date("2026-08-24T00:00:00.000Z"),
      () => ids.shift() ?? "unexpected-id"
    );

    await expect(
      service.stage({
        organizationId: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
        requestId: "request-1",
        draftIds: ["33333333-3333-4333-8333-333333333333"]
      })
    ).resolves.toEqual({ kind: "staged", exportStageId: "stage-1", itemCount: 1 });
    expect(repository.command).toEqual({
      exportStageId: "stage-1",
      auditEventId: "audit-1",
      organizationId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      requestId: "request-1",
      draftIds: ["33333333-3333-4333-8333-333333333333"],
      createdAt: "2026-08-24T00:00:00.000Z"
    });
  });

  it("returns an explicit unavailable outcome without claiming staging succeeded", async () => {
    const repository = new FakeExportStageRepository();
    repository.outcome = { kind: "drafts_not_available" };
    const service = new ProductContentExportStageService(repository);

    await expect(
      service.stage({
        organizationId: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
        requestId: "request-1",
        draftIds: ["33333333-3333-4333-8333-333333333333"]
      })
    ).resolves.toEqual({ kind: "drafts_not_available" });
  });
});

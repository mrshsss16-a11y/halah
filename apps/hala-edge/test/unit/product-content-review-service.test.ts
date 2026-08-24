import { describe, expect, it } from "vitest";
import type {
  ApproveProductFactEvidence,
  ProductContentReviewRepositoryPort,
  ProductFactReviewItem
} from "../../src/modules/product-content/product-content-review-port";
import { ProductContentReviewService } from "../../src/modules/product-content/product-content-review-service";

class FakeProductContentReviewRepository implements ProductContentReviewRepositoryPort {
  public approveResult = true;
  public approvedInput: ApproveProductFactEvidence | null = null;

  public async listEvidenceReviewItems(): Promise<readonly ProductFactReviewItem[]> {
    return Object.freeze([]);
  }

  public async approveEvidence(input: ApproveProductFactEvidence): Promise<boolean> {
    this.approvedInput = input;
    return this.approveResult;
  }
}

describe("ProductContentReviewService", () => {
  it("records an explicit reviewer decision with a timestamp and request ID", async () => {
    const repository = new FakeProductContentReviewRepository();
    const service = new ProductContentReviewService(
      repository,
      () => new Date("2026-08-23T12:00:00.000Z"),
      () => "audit-event-1"
    );

    const outcome = await service.approveEvidence({
      factId: "fact-1",
      organizationId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      reviewNote: "راجعت مصدر الحقائق قبل اعتمادها.",
      requestId: "request-1"
    });

    expect(outcome).toEqual({ kind: "approved" });
    expect(repository.approvedInput).toEqual({
      factId: "fact-1",
      organizationId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      reviewNote: "راجعت مصدر الحقائق قبل اعتمادها.",
      reviewedAt: "2026-08-23T12:00:00.000Z",
      auditEventId: "audit-event-1",
      requestId: "request-1"
    });
  });

  it("returns not_found when the fact does not belong to the caller organization or is no longer pending", async () => {
    const repository = new FakeProductContentReviewRepository();
    repository.approveResult = false;
    const service = new ProductContentReviewService(repository);

    await expect(
      service.approveEvidence({
        factId: "foreign-or-reviewed-fact",
        organizationId: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
        reviewNote: "",
        requestId: "request-1"
      })
    ).resolves.toEqual({ kind: "not_found" });
  });
});

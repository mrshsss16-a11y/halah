import { describe, expect, it } from "vitest";
import type {
  ProductContentDraftReviewItem,
  ProductContentDraftReviewRepositoryPort,
  ReviewProductContentDraft
} from "../../src/modules/product-content/product-content-draft-review-port";
import { ProductContentDraftReviewService } from "../../src/modules/product-content/product-content-draft-review-service";

class FakeDraftReviewRepository implements ProductContentDraftReviewRepositoryPort {
  public shouldReview = true;
  public input: ReviewProductContentDraft | null = null;

  public async listPreviewItems(): Promise<readonly []> {
    return Object.freeze([]);
  }

  public async listDraftReviewItems(): Promise<readonly ProductContentDraftReviewItem[]> {
    return Object.freeze([]);
  }

  public async reviewDraft(input: ReviewProductContentDraft): Promise<boolean> {
    this.input = input;
    return this.shouldReview;
  }
}

describe("ProductContentDraftReviewService", () => {
  it("records an explicit approval decision with reviewer context", async () => {
    const repository = new FakeDraftReviewRepository();
    const service = new ProductContentDraftReviewService(
      repository,
      () => new Date("2026-08-24T00:00:00.000Z"),
      () => "audit-1"
    );

    await expect(
      service.review({
        organizationId: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
        requestId: "request-1",
        draftId: "33333333-3333-4333-8333-333333333333",
        review: { decision: "approve", reviewNote: "مراجعة تركيبية" }
      })
    ).resolves.toEqual({ kind: "reviewed" });
    expect(repository.input).toEqual(
      expect.objectContaining({
        decision: "approve",
        reviewNote: "مراجعة تركيبية",
        auditEventId: "audit-1",
        reviewedAt: "2026-08-24T00:00:00.000Z"
      })
    );
  });

  it("does not claim review success when the draft is unavailable in the organization", async () => {
    const repository = new FakeDraftReviewRepository();
    repository.shouldReview = false;
    const service = new ProductContentDraftReviewService(repository);

    await expect(
      service.review({
        organizationId: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
        requestId: "request-1",
        draftId: "33333333-3333-4333-8333-333333333333",
        review: { decision: "reject", reviewNote: "غير متاح" }
      })
    ).resolves.toEqual({ kind: "not_available" });
  });
});

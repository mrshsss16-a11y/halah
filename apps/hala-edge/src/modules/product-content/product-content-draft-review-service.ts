import type { ProductContentDraftReviewInput } from "@hala/contracts";
import type { ProductContentDraftReviewRepositoryPort } from "./product-content-draft-review-port";

export type ReviewManualProductDraftInput = Readonly<{
  organizationId: string;
  userId: string;
  requestId: string;
  draftId: string;
  review: ProductContentDraftReviewInput;
}>;

export type ReviewManualProductDraftOutcome =
  Readonly<{ kind: "reviewed" }> | Readonly<{ kind: "not_available" }>;

export class ProductContentDraftReviewService {
  public constructor(
    private readonly repository: ProductContentDraftReviewRepositoryPort,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID()
  ) {}

  public async review(
    input: ReviewManualProductDraftInput
  ): Promise<ReviewManualProductDraftOutcome> {
    const reviewed = await this.repository.reviewDraft({
      draftId: input.draftId,
      organizationId: input.organizationId,
      userId: input.userId,
      decision: input.review.decision,
      reviewNote: input.review.reviewNote,
      reviewedAt: this.clock().toISOString(),
      auditEventId: this.createId(),
      requestId: input.requestId
    });
    return reviewed
      ? Object.freeze({ kind: "reviewed" })
      : Object.freeze({ kind: "not_available" });
  }
}

import type { ProductFactEvidenceApprovalInput } from "@hala/contracts";
import type { ProductContentReviewRepositoryPort } from "./product-content-review-port";

export type ApproveProductFactEvidenceInput = Readonly<{
  factId: string;
  organizationId: string;
  userId: string;
  reviewNote: ProductFactEvidenceApprovalInput["reviewNote"];
  requestId: string;
}>;

export type ApproveProductFactEvidenceOutcome =
  Readonly<{ kind: "approved" }> | Readonly<{ kind: "not_found" }>;

export class ProductContentReviewService {
  public constructor(
    private readonly repository: ProductContentReviewRepositoryPort,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID()
  ) {}

  public async approveEvidence(
    input: ApproveProductFactEvidenceInput
  ): Promise<ApproveProductFactEvidenceOutcome> {
    const approved = await this.repository.approveEvidence({
      factId: input.factId,
      organizationId: input.organizationId,
      userId: input.userId,
      reviewNote: input.reviewNote,
      reviewedAt: this.clock().toISOString(),
      auditEventId: this.createId(),
      requestId: input.requestId
    });

    return approved ? Object.freeze({ kind: "approved" }) : Object.freeze({ kind: "not_found" });
  }
}

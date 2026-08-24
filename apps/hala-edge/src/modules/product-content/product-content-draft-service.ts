import type { ProductContentManualDraftInput } from "@hala/contracts";
import { evaluateManualDraftQuality, type DraftQualityReasonCode } from "./draft-quality";
import type { ProductContentDraftRepositoryPort } from "./product-content-draft-port";

export type SubmitManualProductDraftInput = Readonly<{
  organizationId: string;
  userId: string;
  requestId: string;
  draft: ProductContentManualDraftInput;
}>;

export type SubmitManualProductDraftOutcome =
  | Readonly<{ kind: "fact_not_available" }>
  | Readonly<{
      kind: "stored";
      status: "needs_revision" | "ready_for_review";
      reasons: readonly DraftQualityReasonCode[];
    }>;

export class ProductContentDraftService {
  public constructor(
    private readonly repository: ProductContentDraftRepositoryPort,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID()
  ) {}

  public async submit(
    input: SubmitManualProductDraftInput
  ): Promise<SubmitManualProductDraftOutcome> {
    const fact = await this.repository.findApprovedFact(input.organizationId, input.draft.factId);
    if (fact === null) {
      return Object.freeze({ kind: "fact_not_available" });
    }

    const quality = evaluateManualDraftQuality(input.draft, fact.factsJson);
    const createdAt = this.clock().toISOString();
    await this.repository.createDraft({
      id: this.createId(),
      organizationId: input.organizationId,
      productFactSetId: fact.id,
      title: input.draft.title,
      shortDescription: input.draft.shortDescription,
      longDescription: input.draft.longDescription,
      metaDescription: input.draft.metaDescription,
      evidenceMapJson: JSON.stringify({ version: 1, evidence: input.draft.evidence }),
      status: quality.status,
      createdAt,
      auditEventId: this.createId(),
      createdByUserId: input.userId,
      requestId: input.requestId
    });

    return Object.freeze({ kind: "stored", status: quality.status, reasons: quality.reasons });
  }
}

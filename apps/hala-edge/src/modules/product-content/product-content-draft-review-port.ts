export type ProductContentDraftReviewItem = Readonly<{
  id: string;
  productFactSetId: string;
  title: string;
  shortDescription: string;
  longDescription: string;
  metaDescription: string;
  evidenceMapJson: string;
}>;

export type ProductContentPreviewItem = Readonly<{
  id: string;
  sku: string;
  productReference: string;
  title: string;
  shortDescription: string;
  longDescription: string;
  metaDescription: string;
  evidenceMapJson: string;
}>;

export type ReviewProductContentDraft = Readonly<{
  draftId: string;
  organizationId: string;
  userId: string;
  decision: "approve" | "reject";
  reviewNote: string;
  reviewedAt: string;
  auditEventId: string;
  requestId: string;
}>;

export interface ProductContentDraftReviewRepositoryPort {
  listPreviewItems(organizationId: string): Promise<readonly ProductContentPreviewItem[]>;
  listDraftReviewItems(organizationId: string): Promise<readonly ProductContentDraftReviewItem[]>;
  reviewDraft(input: ReviewProductContentDraft): Promise<boolean>;
}

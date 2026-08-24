export type ProductFactReviewItem = Readonly<{
  id: string;
  productImportId: string;
  productReference: string;
  sku: string;
  category: string;
  factsJson: string;
  evidenceStatus: "needs_evidence" | "approved";
  evidenceReviewNote: string;
}>;

export type ApproveProductFactEvidence = Readonly<{
  factId: string;
  organizationId: string;
  userId: string;
  reviewNote: string;
  reviewedAt: string;
  auditEventId: string;
  requestId: string;
}>;

export interface ProductContentReviewRepositoryPort {
  listEvidenceReviewItems(organizationId: string): Promise<readonly ProductFactReviewItem[]>;
  approveEvidence(input: ApproveProductFactEvidence): Promise<boolean>;
}

import type { ProductContentDraftStatus } from "@hala/contracts";

export type ApprovedProductFact = Readonly<{
  id: string;
  factsJson: string;
}>;

export type ApprovedProductFactSummary = Readonly<{
  id: string;
  productReference: string;
  sku: string;
  category: string;
  factsJson: string;
}>;

export type CreateProductContentDraft = Readonly<{
  id: string;
  organizationId: string;
  productFactSetId: string;
  title: string;
  shortDescription: string;
  longDescription: string;
  metaDescription: string;
  evidenceMapJson: string;
  status: Extract<ProductContentDraftStatus, "needs_revision" | "ready_for_review">;
  createdAt: string;
  auditEventId: string;
  createdByUserId: string;
  requestId: string;
}>;

export interface ProductContentDraftRepositoryPort {
  listApprovedFacts(organizationId: string): Promise<readonly ApprovedProductFactSummary[]>;
  findApprovedFact(organizationId: string, factId: string): Promise<ApprovedProductFact | null>;
  createDraft(input: CreateProductContentDraft): Promise<void>;
}

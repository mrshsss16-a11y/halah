export type CreateProductContentExportStage = Readonly<{
  exportStageId: string;
  auditEventId: string;
  organizationId: string;
  userId: string;
  requestId: string;
  draftIds: readonly string[];
  createdAt: string;
}>;

export type ProductContentExportStageRepositoryPort = Readonly<{
  createExportStage(
    input: CreateProductContentExportStage
  ): Promise<
    Readonly<{ kind: "staged"; itemCount: number }> | Readonly<{ kind: "drafts_not_available" }>
  >;
}>;

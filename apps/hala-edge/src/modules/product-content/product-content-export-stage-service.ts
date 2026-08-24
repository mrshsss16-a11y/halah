import type {
  CreateProductContentExportStage,
  ProductContentExportStageRepositoryPort
} from "./product-content-export-stage-port";

export type StageProductContentExportInput = Readonly<{
  organizationId: string;
  userId: string;
  requestId: string;
  draftIds: readonly string[];
}>;

export type StageProductContentExportOutcome =
  | Readonly<{ kind: "staged"; exportStageId: string; itemCount: number }>
  | Readonly<{ kind: "drafts_not_available" }>;

export class ProductContentExportStageService {
  public constructor(
    private readonly repository: ProductContentExportStageRepositoryPort,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID()
  ) {}

  public async stage(
    input: StageProductContentExportInput
  ): Promise<StageProductContentExportOutcome> {
    const command: CreateProductContentExportStage = Object.freeze({
      exportStageId: this.createId(),
      auditEventId: this.createId(),
      organizationId: input.organizationId,
      userId: input.userId,
      requestId: input.requestId,
      draftIds: input.draftIds,
      createdAt: this.now().toISOString()
    });
    const outcome = await this.repository.createExportStage(command);
    if (outcome.kind === "drafts_not_available") {
      return outcome;
    }

    return Object.freeze({
      kind: "staged",
      exportStageId: command.exportStageId,
      itemCount: outcome.itemCount
    });
  }
}

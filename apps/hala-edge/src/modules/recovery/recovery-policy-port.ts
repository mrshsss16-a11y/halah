import type { RecoveryPolicyDraftInput, RecoveryPolicyRecord } from "@hala/contracts";

export interface RecoveryPolicyRepositoryPort {
  list(organizationId: string): Promise<readonly RecoveryPolicyRecord[]>;
  createDraft(input: {
    id: string;
    organizationId: string;
    policy: RecoveryPolicyDraftInput;
    contentHash: string;
    createdByUserId: string;
    createdAt: string;
  }): Promise<RecoveryPolicyRecord>;
  activate(input: {
    organizationId: string;
    policyId: string;
    approvedByUserId: string;
    approvedAt: string;
    requestId: string;
  }): Promise<"activated" | "missing" | "not_draft">;
}

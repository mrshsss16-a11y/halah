import type { RecoveryPolicyDraftInput, RecoveryPolicyRecord } from "@hala/contracts";
import type { RecoveryPolicyRepositoryPort } from "./recovery-policy-port";

function stablePolicyJson(policy: RecoveryPolicyDraftInput): string {
  return JSON.stringify({
    allowsRecovery: policy.allowsRecovery,
    maxAttemptsPerCase: policy.maxAttemptsPerCase,
    maxMessagesPerContactWindow: policy.maxMessagesPerContactWindow,
    replyBudgetPerCase: policy.replyBudgetPerCase
  });
}

async function contentHash(policy: RecoveryPolicyDraftInput): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stablePolicyJson(policy)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class RecoveryPolicyService {
  public constructor(
    private readonly repository: RecoveryPolicyRepositoryPort,
    private readonly clock: () => Date = () => new Date()
  ) {}

  public async list(organizationId: string): Promise<readonly RecoveryPolicyRecord[]> {
    return this.repository.list(organizationId);
  }

  public async createDraft(
    organizationId: string,
    createdByUserId: string,
    policy: RecoveryPolicyDraftInput
  ): Promise<RecoveryPolicyRecord> {
    const createdAt = this.clock().toISOString();
    return this.repository.createDraft({
      id: crypto.randomUUID(),
      organizationId,
      policy,
      contentHash: await contentHash(policy),
      createdByUserId,
      createdAt
    });
  }

  public async activate(
    organizationId: string,
    policyId: string,
    approvedByUserId: string,
    requestId: string
  ): Promise<"activated" | "missing" | "not_draft"> {
    return this.repository.activate({
      organizationId,
      policyId,
      approvedByUserId,
      approvedAt: this.clock().toISOString(),
      requestId
    });
  }
}

import type {
  ConversationMessage,
  ConversationThread,
  CustomerMemoryRepositoryPort,
  CustomerMemoryScope,
  CustomerProfile,
  MemoryFact
} from "./customer-memory-port";

function requireScope(scope: CustomerMemoryScope): void {
  if (!scope.organizationId || !scope.storeConnectionId) {
    throw new Error("customer_memory_scope_required");
  }
}

function assertScope(
  scope: CustomerMemoryScope,
  record: { organizationId: string; storeConnectionId: string }
): void {
  requireScope(scope);
  if (
    record.organizationId !== scope.organizationId ||
    record.storeConnectionId !== scope.storeConnectionId
  ) {
    throw new Error("customer_memory_scope_mismatch");
  }
}

function requireIdentity(input: {
  externalCustomerId?: string;
  contactHash?: string;
  visitorKeyHash?: string;
}): void {
  if (!input.externalCustomerId && !input.contactHash && !input.visitorKeyHash) {
    throw new Error("customer_identity_required");
  }
}

export class CustomerMemoryService {
  public constructor(
    private readonly repository: CustomerMemoryRepositoryPort,
    private readonly clock: () => Date = () => new Date()
  ) {}

  public async findOrCreateProfile(
    input: CustomerMemoryScope & {
      externalCustomerId?: string;
      contactHash?: string;
      visitorKeyHash?: string;
      displayName?: string;
    }
  ): Promise<CustomerProfile> {
    requireScope(input);
    requireIdentity(input);
    const existing = await this.repository.findProfileByIdentity(input);
    if (existing) {
      assertScope(input, existing);
      const touched = await this.repository.touchProfile({
        organizationId: input.organizationId,
        storeConnectionId: input.storeConnectionId,
        profileId: existing.id,
        lastSeenAt: this.clock().toISOString()
      });
      if (!touched) throw new Error("customer_profile_not_found_after_touch");
      assertScope(input, touched);
      return touched;
    }
    const now = this.clock().toISOString();
    return this.repository.createProfile({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      storeConnectionId: input.storeConnectionId,
      externalCustomerId: input.externalCustomerId ?? null,
      contactHash: input.contactHash ?? null,
      visitorKeyHash: input.visitorKeyHash ?? null,
      displayName: input.displayName ?? null,
      consentStatus: "unknown",
      status: "active",
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now
    });
  }

  public async resumeThread(
    input: CustomerMemoryScope & {
      profileId: string;
      channel: ConversationThread["channel"];
      memoryConsent?: ConversationThread["memoryConsent"];
    }
  ): Promise<ConversationThread> {
    requireScope(input);
    const existing = await this.repository.findActiveThread(input);
    if (existing) {
      assertScope(input, existing);
      if (existing.customerProfileId !== input.profileId)
        throw new Error("customer_thread_profile_mismatch");
      return existing;
    }
    const now = this.clock().toISOString();
    return this.repository.createThread({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      storeConnectionId: input.storeConnectionId,
      customerProfileId: input.profileId,
      channel: input.channel,
      status: "active",
      memoryConsent: input.memoryConsent ?? "unknown",
      summaryCiphertext: null,
      summaryKeyVersion: null,
      lastMessageAt: null,
      createdAt: now,
      updatedAt: now
    });
  }

  public async appendMessage(input: ConversationMessage): Promise<ConversationMessage> {
    assertScope(input, input);
    if (!input.idempotencyKey || !input.bodyCiphertext || input.bodyKeyVersion < 1) {
      throw new Error("conversation_message_invalid");
    }
    const thread = await this.repository.findThread({
      organizationId: input.organizationId,
      storeConnectionId: input.storeConnectionId,
      threadId: input.conversationId
    });
    if (!thread) throw new Error("conversation_thread_not_found");
    assertScope(input, thread);
    if (thread.customerProfileId !== input.customerProfileId)
      throw new Error("conversation_profile_mismatch");
    return this.repository.appendMessage(input);
  }

  public async recentContext(
    input: CustomerMemoryScope & {
      threadId: string;
      profileId: string;
      limit?: number;
    }
  ): Promise<readonly ConversationMessage[]> {
    requireScope(input);
    if (
      !Number.isInteger(input.limit ?? 20) ||
      (input.limit ?? 20) < 1 ||
      (input.limit ?? 20) > 50
    ) {
      throw new Error("conversation_context_limit_invalid");
    }
    const thread = await this.repository.findThread(input);
    if (!thread) throw new Error("conversation_thread_not_found");
    assertScope(input, thread);
    if (thread.customerProfileId !== input.profileId)
      throw new Error("conversation_profile_mismatch");
    return this.repository.listRecentMessages({ ...input, limit: input.limit ?? 20 });
  }

  public async rememberFact(input: MemoryFact): Promise<MemoryFact> {
    assertScope(input, input);
    if (input.factKeyVersion < 1 || input.status !== "active")
      throw new Error("memory_fact_not_active");
    return this.repository.upsertFact(input);
  }

  public async activeFacts(
    input: CustomerMemoryScope & { profileId: string }
  ): Promise<readonly MemoryFact[]> {
    requireScope(input);
    return this.repository.listActiveFacts({ ...input, now: this.clock().toISOString() });
  }

  public async forgetCustomerMemory(
    input: CustomerMemoryScope & { profileId: string }
  ): Promise<number> {
    requireScope(input);
    return this.repository.revokeFacts({ ...input, revokedAt: this.clock().toISOString() });
  }
}

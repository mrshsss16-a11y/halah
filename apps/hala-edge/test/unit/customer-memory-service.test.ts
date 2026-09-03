import { describe, expect, it } from "vitest";
import { CustomerMemoryService } from "../../src/modules/customer-memory/customer-memory-service";
import type {
  ConversationMessage,
  ConversationThread,
  CustomerMemoryRepositoryPort,
  CustomerMemoryScope,
  CustomerProfile,
  MemoryFact
} from "../../src/modules/customer-memory/customer-memory-port";

class InMemoryCustomerMemoryRepository implements CustomerMemoryRepositoryPort {
  private readonly profiles = new Map<string, CustomerProfile>();
  private readonly threads = new Map<string, ConversationThread>();
  private readonly messages = new Map<string, ConversationMessage>();
  private readonly facts = new Map<string, MemoryFact>();

  public async findProfileByIdentity(
    input: CustomerMemoryScope & {
      externalCustomerId?: string;
      contactHash?: string;
      visitorKeyHash?: string;
    }
  ): Promise<CustomerProfile | null> {
    return (
      [...this.profiles.values()].find(
        (record) =>
          record.organizationId === input.organizationId &&
          record.storeConnectionId === input.storeConnectionId &&
          record.status !== "deleted" &&
          ((input.externalCustomerId !== undefined &&
            record.externalCustomerId === input.externalCustomerId) ||
            (input.contactHash !== undefined && record.contactHash === input.contactHash) ||
            (input.visitorKeyHash !== undefined && record.visitorKeyHash === input.visitorKeyHash))
      ) ?? null
    );
  }

  public async createProfile(input: CustomerProfile): Promise<CustomerProfile> {
    this.profiles.set(input.id, input);
    return input;
  }

  public async touchProfile(
    input: CustomerMemoryScope & { profileId: string; lastSeenAt: string }
  ): Promise<CustomerProfile | null> {
    const old = this.profiles.get(input.profileId);
    if (
      !old ||
      old.organizationId !== input.organizationId ||
      old.storeConnectionId !== input.storeConnectionId
    )
      return null;
    const updated = { ...old, lastSeenAt: input.lastSeenAt, updatedAt: input.lastSeenAt };
    this.profiles.set(old.id, updated);
    return updated;
  }

  public async findThread(
    input: CustomerMemoryScope & { threadId: string }
  ): Promise<ConversationThread | null> {
    const record = this.threads.get(input.threadId);
    return record &&
      record.organizationId === input.organizationId &&
      record.storeConnectionId === input.storeConnectionId
      ? record
      : null;
  }

  public async findActiveThread(
    input: CustomerMemoryScope & { profileId: string; channel: ConversationThread["channel"] }
  ): Promise<ConversationThread | null> {
    return (
      [...this.threads.values()].find(
        (record) =>
          record.organizationId === input.organizationId &&
          record.storeConnectionId === input.storeConnectionId &&
          record.customerProfileId === input.profileId &&
          record.channel === input.channel &&
          record.status === "active"
      ) ?? null
    );
  }

  public async createThread(input: ConversationThread): Promise<ConversationThread> {
    this.threads.set(input.id, input);
    return input;
  }

  public async appendMessage(input: ConversationMessage): Promise<ConversationMessage> {
    const existing = [...this.messages.values()].find(
      (record) =>
        record.organizationId === input.organizationId &&
        record.idempotencyKey === input.idempotencyKey
    );
    if (existing) return existing;
    this.messages.set(input.id, input);
    return input;
  }

  public async listRecentMessages(
    input: CustomerMemoryScope & { threadId: string; profileId: string; limit: number }
  ): Promise<readonly ConversationMessage[]> {
    return [...this.messages.values()]
      .filter(
        (record) =>
          record.organizationId === input.organizationId &&
          record.storeConnectionId === input.storeConnectionId &&
          record.conversationId === input.threadId &&
          record.customerProfileId === input.profileId
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-input.limit);
  }

  public async upsertFact(input: MemoryFact): Promise<MemoryFact> {
    this.facts.set(input.id, input);
    return input;
  }

  public async listActiveFacts(
    input: CustomerMemoryScope & { profileId: string; now: string }
  ): Promise<readonly MemoryFact[]> {
    return [...this.facts.values()].filter(
      (record) =>
        record.organizationId === input.organizationId &&
        record.storeConnectionId === input.storeConnectionId &&
        record.customerProfileId === input.profileId &&
        record.status === "active" &&
        (record.expiresAt === null || record.expiresAt > input.now)
    );
  }

  public async revokeFacts(
    input: CustomerMemoryScope & { profileId: string; revokedAt: string }
  ): Promise<number> {
    let count = 0;
    for (const [id, record] of this.facts) {
      if (
        record.organizationId === input.organizationId &&
        record.storeConnectionId === input.storeConnectionId &&
        record.customerProfileId === input.profileId &&
        record.status === "active"
      ) {
        this.facts.set(id, { ...record, status: "revoked", updatedAt: input.revokedAt });
        count += 1;
      }
    }
    return count;
  }
}

const clock = () => new Date("2026-09-03T00:00:00.000Z");
const scopeA = { organizationId: "org-a", storeConnectionId: "store-a" } as const;
const scopeB = { organizationId: "org-b", storeConnectionId: "store-b" } as const;

function message(
  thread: ConversationThread,
  scope: CustomerMemoryScope,
  profileId: string,
  id: string
): ConversationMessage {
  return {
    id,
    organizationId: scope.organizationId,
    storeConnectionId: scope.storeConnectionId,
    conversationId: thread.id,
    customerProfileId: profileId,
    senderRole: "customer",
    bodyCiphertext: `cipher-${id}`,
    bodyKeyVersion: 1,
    redactedText: null,
    sourceMessageId: null,
    idempotencyKey: `idem-${id}`,
    createdAt: "2026-09-03T00:00:00.000Z"
  };
}

describe("CustomerMemoryService", () => {
  it("resumes the same customer thread after a later visit", async () => {
    const service = new CustomerMemoryService(new InMemoryCustomerMemoryRepository(), clock);
    const first = await service.findOrCreateProfile({
      ...scopeA,
      externalCustomerId: "customer-1"
    });
    const thread = await service.resumeThread({
      ...scopeA,
      profileId: first.id,
      channel: "web",
      memoryConsent: "granted"
    });
    await service.appendMessage(message(thread, scopeA, first.id, "m1"));
    const later = await service.findOrCreateProfile({
      ...scopeA,
      externalCustomerId: "customer-1"
    });
    const resumed = await service.resumeThread({ ...scopeA, profileId: later.id, channel: "web" });
    expect(later.id).toBe(first.id);
    expect(resumed.id).toBe(thread.id);
    expect(
      (await service.recentContext({ ...scopeA, threadId: resumed.id, profileId: later.id })).map(
        (item) => item.id
      )
    ).toEqual(["m1"]);
  });

  it("rejects a cross-store thread access", async () => {
    const repository = new InMemoryCustomerMemoryRepository();
    const service = new CustomerMemoryService(repository, clock);
    const profile = await service.findOrCreateProfile({
      ...scopeA,
      externalCustomerId: "same-external-id"
    });
    const thread = await service.resumeThread({ ...scopeA, profileId: profile.id, channel: "web" });
    await expect(
      service.recentContext({ ...scopeB, threadId: thread.id, profileId: profile.id })
    ).rejects.toThrow("conversation_thread_not_found");
  });

  it("does not expose facts from another organization", async () => {
    const repository = new InMemoryCustomerMemoryRepository();
    const service = new CustomerMemoryService(repository, clock);
    const profileA = await service.findOrCreateProfile({
      ...scopeA,
      externalCustomerId: "customer-a"
    });
    const profileB = await service.findOrCreateProfile({
      ...scopeB,
      externalCustomerId: "customer-b"
    });
    const base = {
      factType: "preference" as const,
      factCiphertext: "cipher",
      factKeyVersion: 1,
      confidence: "explicit" as const,
      status: "active" as const,
      sourceConversationId: null,
      expiresAt: null,
      createdAt: clock().toISOString(),
      updatedAt: clock().toISOString()
    };
    await service.rememberFact({
      ...base,
      id: "fact-a",
      ...scopeA,
      customerProfileId: profileA.id
    });
    await service.rememberFact({
      ...base,
      id: "fact-b",
      ...scopeB,
      customerProfileId: profileB.id
    });
    const facts = await service.activeFacts({ ...scopeA, profileId: profileA.id });
    expect(facts.map((item) => item.id)).toEqual(["fact-a"]);
  });

  it("requires a verified identity instead of guessing from a message", async () => {
    const service = new CustomerMemoryService(new InMemoryCustomerMemoryRepository(), clock);
    await expect(service.findOrCreateProfile(scopeA)).rejects.toThrow("customer_identity_required");
  });
});

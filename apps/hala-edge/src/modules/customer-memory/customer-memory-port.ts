export type CustomerMemoryScope = Readonly<{
  organizationId: string;
  storeConnectionId: string;
}>;

export type CustomerProfile = Readonly<{
  id: string;
  organizationId: string;
  storeConnectionId: string;
  externalCustomerId: string | null;
  contactHash: string | null;
  visitorKeyHash: string | null;
  displayName: string | null;
  consentStatus: "unknown" | "granted" | "withdrawn";
  status: "active" | "blocked" | "deleted";
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}>;

export type ConversationThread = Readonly<{
  id: string;
  organizationId: string;
  storeConnectionId: string;
  customerProfileId: string;
  channel: "web" | "salla" | "whatsapp";
  status: "active" | "closed" | "escalated";
  memoryConsent: "unknown" | "granted" | "withdrawn";
  summaryCiphertext: string | null;
  summaryKeyVersion: number | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type ConversationMessage = Readonly<{
  id: string;
  organizationId: string;
  storeConnectionId: string;
  conversationId: string;
  customerProfileId: string;
  senderRole: "customer" | "assistant" | "operator" | "system";
  bodyCiphertext: string;
  bodyKeyVersion: number;
  redactedText: string | null;
  sourceMessageId: string | null;
  idempotencyKey: string;
  createdAt: string;
}>;

export type MemoryFact = Readonly<{
  id: string;
  organizationId: string;
  storeConnectionId: string;
  customerProfileId: string;
  factType: "preference" | "intent" | "consent" | "cart_context" | "support_context";
  factCiphertext: string;
  factKeyVersion: number;
  confidence: "explicit" | "confirmed" | "inferred";
  status: "active" | "revoked" | "expired";
  sourceConversationId: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export interface CustomerMemoryRepositoryPort {
  findProfileByIdentity(
    input: CustomerMemoryScope & {
      externalCustomerId?: string;
      contactHash?: string;
      visitorKeyHash?: string;
    }
  ): Promise<CustomerProfile | null>;
  createProfile(input: CustomerProfile): Promise<CustomerProfile>;
  touchProfile(
    input: CustomerMemoryScope & { profileId: string; lastSeenAt: string }
  ): Promise<CustomerProfile | null>;
  findThread(input: CustomerMemoryScope & { threadId: string }): Promise<ConversationThread | null>;
  findActiveThread(
    input: CustomerMemoryScope & { profileId: string; channel: ConversationThread["channel"] }
  ): Promise<ConversationThread | null>;
  createThread(input: ConversationThread): Promise<ConversationThread>;
  appendMessage(input: ConversationMessage): Promise<ConversationMessage>;
  listRecentMessages(
    input: CustomerMemoryScope & { threadId: string; profileId: string; limit: number }
  ): Promise<readonly ConversationMessage[]>;
  upsertFact(input: MemoryFact): Promise<MemoryFact>;
  listActiveFacts(
    input: CustomerMemoryScope & { profileId: string; now: string }
  ): Promise<readonly MemoryFact[]>;
  revokeFacts(
    input: CustomerMemoryScope & { profileId: string; revokedAt: string }
  ): Promise<number>;
}

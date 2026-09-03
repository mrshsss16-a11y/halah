import type {
  ConversationMessage,
  ConversationThread,
  CustomerMemoryRepositoryPort,
  CustomerMemoryScope,
  CustomerProfile,
  MemoryFact
} from "../../modules/customer-memory/customer-memory-port";

function profile(row: Record<string, unknown>): CustomerProfile {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    storeConnectionId: String(row["store_connection_id"]),
    externalCustomerId:
      typeof row["external_customer_id"] === "string" ? row["external_customer_id"] : null,
    contactHash: typeof row["contact_hash"] === "string" ? row["contact_hash"] : null,
    visitorKeyHash: typeof row["visitor_key_hash"] === "string" ? row["visitor_key_hash"] : null,
    displayName: typeof row["display_name"] === "string" ? row["display_name"] : null,
    consentStatus: row["consent_status"] as CustomerProfile["consentStatus"],
    status: row["status"] as CustomerProfile["status"],
    lastSeenAt: String(row["last_seen_at"]),
    createdAt: String(row["created_at"]),
    updatedAt: String(row["updated_at"])
  };
}

function thread(row: Record<string, unknown>): ConversationThread {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    storeConnectionId: String(row["store_connection_id"]),
    customerProfileId: String(row["customer_profile_id"]),
    channel: row["channel"] as ConversationThread["channel"],
    status: row["status"] as ConversationThread["status"],
    memoryConsent: row["memory_consent"] as ConversationThread["memoryConsent"],
    summaryCiphertext:
      typeof row["summary_ciphertext"] === "string" ? row["summary_ciphertext"] : null,
    summaryKeyVersion:
      typeof row["summary_key_version"] === "number" ? row["summary_key_version"] : null,
    lastMessageAt: typeof row["last_message_at"] === "string" ? row["last_message_at"] : null,
    createdAt: String(row["created_at"]),
    updatedAt: String(row["updated_at"])
  };
}

function message(row: Record<string, unknown>): ConversationMessage {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    storeConnectionId: String(row["store_connection_id"]),
    conversationId: String(row["conversation_id"]),
    customerProfileId: String(row["customer_profile_id"]),
    senderRole: row["sender_role"] as ConversationMessage["senderRole"],
    bodyCiphertext: String(row["body_ciphertext"]),
    bodyKeyVersion: Number(row["body_key_version"]),
    redactedText: typeof row["redacted_text"] === "string" ? row["redacted_text"] : null,
    sourceMessageId: typeof row["source_message_id"] === "string" ? row["source_message_id"] : null,
    idempotencyKey: String(row["idempotency_key"]),
    createdAt: String(row["created_at"])
  };
}

function fact(row: Record<string, unknown>): MemoryFact {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    storeConnectionId: String(row["store_connection_id"]),
    customerProfileId: String(row["customer_profile_id"]),
    factType: row["fact_type"] as MemoryFact["factType"],
    factCiphertext: String(row["fact_ciphertext"]),
    factKeyVersion: Number(row["fact_key_version"]),
    confidence: row["confidence"] as MemoryFact["confidence"],
    status: row["status"] as MemoryFact["status"],
    sourceConversationId:
      typeof row["source_conversation_id"] === "string" ? row["source_conversation_id"] : null,
    expiresAt: typeof row["expires_at"] === "string" ? row["expires_at"] : null,
    createdAt: String(row["created_at"]),
    updatedAt: String(row["updated_at"])
  };
}

export class CustomerMemoryRepository implements CustomerMemoryRepositoryPort {
  public constructor(private readonly database: D1Database) {}

  public async findProfileByIdentity(
    input: CustomerMemoryScope & {
      externalCustomerId?: string;
      contactHash?: string;
      visitorKeyHash?: string;
    }
  ): Promise<CustomerProfile | null> {
    const row = await this.database
      .prepare(
        "SELECT * FROM customer_profiles WHERE organization_id = ?1 AND store_connection_id = ?2 AND ((?3 IS NOT NULL AND external_customer_id = ?3) OR (?4 IS NOT NULL AND contact_hash = ?4) OR (?5 IS NOT NULL AND visitor_key_hash = ?5)) AND status <> 'deleted' ORDER BY updated_at DESC LIMIT 1"
      )
      .bind(
        input.organizationId,
        input.storeConnectionId,
        input.externalCustomerId ?? null,
        input.contactHash ?? null,
        input.visitorKeyHash ?? null
      )
      .first<Record<string, unknown>>();
    return row ? profile(row) : null;
  }

  public async createProfile(input: CustomerProfile): Promise<CustomerProfile> {
    await this.database
      .prepare(
        "INSERT INTO customer_profiles (id, organization_id, store_connection_id, external_customer_id, contact_hash, visitor_key_hash, display_name, consent_status, status, last_seen_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?10)"
      )
      .bind(
        input.id,
        input.organizationId,
        input.storeConnectionId,
        input.externalCustomerId,
        input.contactHash,
        input.visitorKeyHash,
        input.displayName,
        input.consentStatus,
        input.status,
        input.lastSeenAt
      )
      .run();
    return input;
  }

  public async touchProfile(
    input: CustomerMemoryScope & { profileId: string; lastSeenAt: string }
  ): Promise<CustomerProfile | null> {
    await this.database
      .prepare(
        "UPDATE customer_profiles SET last_seen_at = ?1, updated_at = ?1 WHERE id = ?2 AND organization_id = ?3 AND store_connection_id = ?4 AND status <> 'deleted'"
      )
      .bind(input.lastSeenAt, input.profileId, input.organizationId, input.storeConnectionId)
      .run();
    const row = await this.database
      .prepare(
        "SELECT * FROM customer_profiles WHERE id = ?1 AND organization_id = ?2 AND store_connection_id = ?3"
      )
      .bind(input.profileId, input.organizationId, input.storeConnectionId)
      .first<Record<string, unknown>>();
    return row ? profile(row) : null;
  }

  public async findThread(
    input: CustomerMemoryScope & { threadId: string }
  ): Promise<ConversationThread | null> {
    const row = await this.database
      .prepare(
        "SELECT * FROM conversation_threads WHERE id = ?1 AND organization_id = ?2 AND store_connection_id = ?3"
      )
      .bind(input.threadId, input.organizationId, input.storeConnectionId)
      .first<Record<string, unknown>>();
    return row ? thread(row) : null;
  }

  public async findActiveThread(
    input: CustomerMemoryScope & { profileId: string; channel: ConversationThread["channel"] }
  ): Promise<ConversationThread | null> {
    const row = await this.database
      .prepare(
        "SELECT * FROM conversation_threads WHERE organization_id = ?1 AND store_connection_id = ?2 AND customer_profile_id = ?3 AND channel = ?4 AND status = 'active' ORDER BY updated_at DESC LIMIT 1"
      )
      .bind(input.organizationId, input.storeConnectionId, input.profileId, input.channel)
      .first<Record<string, unknown>>();
    return row ? thread(row) : null;
  }

  public async createThread(input: ConversationThread): Promise<ConversationThread> {
    await this.database
      .prepare(
        "INSERT INTO conversation_threads (id, organization_id, store_connection_id, customer_profile_id, channel, status, memory_consent, summary_ciphertext, summary_key_version, last_message_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)"
      )
      .bind(
        input.id,
        input.organizationId,
        input.storeConnectionId,
        input.customerProfileId,
        input.channel,
        input.status,
        input.memoryConsent,
        input.summaryCiphertext,
        input.summaryKeyVersion,
        input.lastMessageAt,
        input.createdAt
      )
      .run();
    return input;
  }

  public async appendMessage(input: ConversationMessage): Promise<ConversationMessage> {
    await this.database
      .prepare(
        "INSERT INTO conversation_messages (id, organization_id, store_connection_id, conversation_id, customer_profile_id, sender_role, body_ciphertext, body_key_version, redacted_text, source_message_id, idempotency_key, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) ON CONFLICT (organization_id, idempotency_key) DO NOTHING"
      )
      .bind(
        input.id,
        input.organizationId,
        input.storeConnectionId,
        input.conversationId,
        input.customerProfileId,
        input.senderRole,
        input.bodyCiphertext,
        input.bodyKeyVersion,
        input.redactedText,
        input.sourceMessageId,
        input.idempotencyKey,
        input.createdAt
      )
      .run();
    const row = await this.database
      .prepare(
        "SELECT * FROM conversation_messages WHERE organization_id = ?1 AND store_connection_id = ?2 AND idempotency_key = ?3"
      )
      .bind(input.organizationId, input.storeConnectionId, input.idempotencyKey)
      .first<Record<string, unknown>>();
    if (!row) throw new Error("conversation_message_not_persisted");
    return message(row);
  }

  public async listRecentMessages(
    input: CustomerMemoryScope & { threadId: string; profileId: string; limit: number }
  ): Promise<readonly ConversationMessage[]> {
    const result = await this.database
      .prepare(
        "SELECT * FROM conversation_messages WHERE organization_id = ?1 AND store_connection_id = ?2 AND conversation_id = ?3 AND customer_profile_id = ?4 ORDER BY created_at DESC LIMIT ?5"
      )
      .bind(
        input.organizationId,
        input.storeConnectionId,
        input.threadId,
        input.profileId,
        input.limit
      )
      .all<Record<string, unknown>>();
    return result.results.map(message).reverse();
  }

  public async upsertFact(input: MemoryFact): Promise<MemoryFact> {
    await this.database
      .prepare(
        "INSERT INTO customer_memory_facts (id, organization_id, store_connection_id, customer_profile_id, fact_type, fact_ciphertext, fact_key_version, confidence, status, source_conversation_id, expires_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12) ON CONFLICT (id) DO UPDATE SET fact_ciphertext = excluded.fact_ciphertext, fact_key_version = excluded.fact_key_version, confidence = excluded.confidence, status = excluded.status, expires_at = excluded.expires_at, updated_at = excluded.updated_at WHERE customer_memory_facts.organization_id = excluded.organization_id AND customer_memory_facts.store_connection_id = excluded.store_connection_id"
      )
      .bind(
        input.id,
        input.organizationId,
        input.storeConnectionId,
        input.customerProfileId,
        input.factType,
        input.factCiphertext,
        input.factKeyVersion,
        input.confidence,
        input.status,
        input.sourceConversationId,
        input.expiresAt,
        input.createdAt
      )
      .run();
    return input;
  }

  public async listActiveFacts(
    input: CustomerMemoryScope & { profileId: string; now: string }
  ): Promise<readonly MemoryFact[]> {
    const result = await this.database
      .prepare(
        "SELECT * FROM customer_memory_facts WHERE organization_id = ?1 AND store_connection_id = ?2 AND customer_profile_id = ?3 AND status = 'active' AND (expires_at IS NULL OR expires_at > ?4) ORDER BY updated_at DESC"
      )
      .bind(input.organizationId, input.storeConnectionId, input.profileId, input.now)
      .all<Record<string, unknown>>();
    return result.results.map(fact);
  }

  public async revokeFacts(
    input: CustomerMemoryScope & { profileId: string; revokedAt: string }
  ): Promise<number> {
    const result = await this.database
      .prepare(
        "UPDATE customer_memory_facts SET status = 'revoked', updated_at = ?1 WHERE organization_id = ?2 AND store_connection_id = ?3 AND customer_profile_id = ?4 AND status = 'active'"
      )
      .bind(input.revokedAt, input.organizationId, input.storeConnectionId, input.profileId)
      .run();
    return result.meta.changes;
  }
}

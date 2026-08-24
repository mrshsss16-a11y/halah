import type { OrganizationRole } from "@hala/contracts";
import type {
  ActiveOrganizationMembership,
  ActiveSessionIdentity,
  CreateIdentityRecord,
  CreateSessionRecord,
  IdentityRepositoryPort,
  IdentityUser,
  StoredCredential
} from "../../modules/identity/identity-port";

export type {
  ActiveOrganizationMembership,
  ActiveSessionIdentity,
  CreateIdentityRecord,
  CreateSessionRecord,
  IdentityRepositoryPort,
  IdentityUser,
  StoredCredential
} from "../../modules/identity/identity-port";

const validOrganizationRoles = new Set<OrganizationRole>([
  "owner",
  "operator",
  "reviewer",
  "viewer"
]);

function toIdentityUser(row: Record<string, unknown>): IdentityUser | null {
  const id = row["id"];
  const emailNormalized = row["email_normalized"];
  const status = row["status"];
  if (
    typeof id !== "string" ||
    typeof emailNormalized !== "string" ||
    (status !== "active" && status !== "disabled")
  ) {
    return null;
  }

  return Object.freeze({ id, emailNormalized, status });
}

function toStoredCredential(row: Record<string, unknown>): StoredCredential | null {
  const userId = row["user_id"];
  const passwordSalt = row["password_salt"];
  const passwordHash = row["password_hash"];
  const algorithm = row["algorithm"];
  const iterations = row["iterations"];
  if (
    typeof userId !== "string" ||
    typeof passwordSalt !== "string" ||
    typeof passwordHash !== "string" ||
    algorithm !== "PBKDF2-SHA-256" ||
    typeof iterations !== "number" ||
    !Number.isInteger(iterations)
  ) {
    return null;
  }

  return Object.freeze({ userId, passwordSalt, passwordHash, algorithm, iterations });
}

function toActiveOrganizationMembership(
  row: Record<string, unknown>
): ActiveOrganizationMembership | null {
  const organizationId = row["organization_id"];
  return typeof organizationId === "string" ? Object.freeze({ organizationId }) : null;
}

function toActiveSessionIdentity(row: Record<string, unknown>): ActiveSessionIdentity | null {
  const sessionId = row["session_id"];
  const userId = row["user_id"];
  const organizationId = row["organization_id"];
  const organizationName = row["organization_name"];
  const role = row["role"];
  const expiresAt = row["expires_at"];
  if (
    typeof sessionId !== "string" ||
    typeof userId !== "string" ||
    typeof organizationId !== "string" ||
    typeof organizationName !== "string" ||
    typeof expiresAt !== "string" ||
    typeof role !== "string" ||
    !validOrganizationRoles.has(role as OrganizationRole)
  ) {
    return null;
  }

  return Object.freeze({
    sessionId,
    userId,
    organizationId,
    organizationName,
    role: role as OrganizationRole,
    expiresAt
  });
}

export class IdentityRepository implements IdentityRepositoryPort {
  public constructor(private readonly database: D1Database) {}

  public async findUserByEmail(emailNormalized: string): Promise<IdentityUser | null> {
    const result = await this.database
      .prepare("SELECT id, email_normalized, status FROM users WHERE email_normalized = ?1")
      .bind(emailNormalized)
      .first<Record<string, unknown>>();
    return result === null ? null : toIdentityUser(result);
  }

  public async findUserById(userId: string): Promise<IdentityUser | null> {
    const result = await this.database
      .prepare("SELECT id, email_normalized, status FROM users WHERE id = ?1")
      .bind(userId)
      .first<Record<string, unknown>>();
    return result === null ? null : toIdentityUser(result);
  }

  public async findCredentialByUserId(userId: string): Promise<StoredCredential | null> {
    const result = await this.database
      .prepare(
        "SELECT user_id, password_salt, password_hash, algorithm, iterations FROM user_credentials WHERE user_id = ?1"
      )
      .bind(userId)
      .first<Record<string, unknown>>();
    return result === null ? null : toStoredCredential(result);
  }

  public async findDefaultActiveMembership(
    userId: string
  ): Promise<ActiveOrganizationMembership | null> {
    const result = await this.database
      .prepare(
        "SELECT m.organization_id FROM organization_members m JOIN organizations o ON o.id = m.organization_id WHERE m.user_id = ?1 AND o.status = 'active' ORDER BY m.created_at ASC LIMIT 1"
      )
      .bind(userId)
      .first<Record<string, unknown>>();
    return result === null ? null : toActiveOrganizationMembership(result);
  }

  public async hasActiveMembership(userId: string, organizationId: string): Promise<boolean> {
    const result = await this.database
      .prepare(
        "SELECT 1 FROM organization_members m JOIN organizations o ON o.id = m.organization_id WHERE m.user_id = ?1 AND m.organization_id = ?2 AND o.status = 'active' LIMIT 1"
      )
      .bind(userId, organizationId)
      .first();
    return result !== null;
  }

  public async createOwnerIdentity(record: CreateIdentityRecord): Promise<void> {
    await this.database.batch([
      this.database
        .prepare(
          "INSERT INTO users (id, email_normalized, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)"
        )
        .bind(record.userId, record.emailNormalized, record.createdAt),
      this.database
        .prepare(
          "INSERT INTO organizations (id, display_name, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)"
        )
        .bind(record.organizationId, record.organizationName, record.createdAt),
      this.database
        .prepare(
          "INSERT INTO organization_members (organization_id, user_id, role, created_at) VALUES (?1, ?2, 'owner', ?3)"
        )
        .bind(record.organizationId, record.userId, record.createdAt),
      this.database
        .prepare(
          "INSERT INTO user_credentials (user_id, password_salt, password_hash, algorithm, iterations, password_updated_at) VALUES (?1, ?2, ?3, 'PBKDF2-SHA-256', ?4, ?5)"
        )
        .bind(
          record.userId,
          record.passwordSalt,
          record.passwordHash,
          record.passwordIterations,
          record.createdAt
        )
    ]);
  }

  public async createSession(input: CreateSessionRecord): Promise<void> {
    await this.database
      .prepare(
        "INSERT INTO user_sessions (id, user_id, organization_id, token_hash, expires_at, revoked_at, last_seen_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?6)"
      )
      .bind(
        input.sessionId,
        input.userId,
        input.organizationId,
        input.tokenHash,
        input.expiresAt,
        input.createdAt
      )
      .run();
  }

  public async findActiveSession(
    tokenHash: string,
    now: string
  ): Promise<ActiveSessionIdentity | null> {
    const result = await this.database
      .prepare(
        "SELECT s.id AS session_id, u.id AS user_id, s.organization_id, o.display_name AS organization_name, m.role, s.expires_at FROM user_sessions s JOIN users u ON u.id = s.user_id JOIN organization_members m ON m.user_id = s.user_id AND m.organization_id = s.organization_id JOIN organizations o ON o.id = s.organization_id WHERE s.token_hash = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2 AND u.status = 'active' AND o.status = 'active' LIMIT 1"
      )
      .bind(tokenHash, now)
      .first<Record<string, unknown>>();
    return result === null ? null : toActiveSessionIdentity(result);
  }

  public async revokeSession(tokenHash: string, revokedAt: string): Promise<void> {
    await this.database
      .prepare(
        "UPDATE user_sessions SET revoked_at = ?2 WHERE token_hash = ?1 AND revoked_at IS NULL"
      )
      .bind(tokenHash, revokedAt)
      .run();
  }
}

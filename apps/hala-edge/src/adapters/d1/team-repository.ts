import type { OrganizationRole, TeamInvitation, TeamMember } from "@hala/contracts";
import type {
  CreateTeamInvitationRecord,
  TeamInvitationAcceptResult,
  TeamInvitationCreateResult,
  TeamMemberMutationResult,
  TeamRepositoryPort
} from "../../modules/identity/team-repository-port";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function memberFromRow(row: Record<string, unknown>): TeamMember | null {
  const userId = row["user_id"];
  const email = row["email_normalized"];
  const role = row["role"];
  const createdAt = row["created_at"];
  if (
    typeof userId !== "string" ||
    typeof email !== "string" ||
    (role !== "owner" && role !== "operator" && role !== "reviewer" && role !== "viewer") ||
    typeof createdAt !== "string"
  ) {
    return null;
  }
  return Object.freeze({ userId, email, role, createdAt });
}

function invitationFromRow(row: Record<string, unknown>): TeamInvitation | null {
  const id = row["id"];
  const email = row["email_normalized"];
  const role = row["role"];
  const status = row["status"];
  const expiresAt = row["expires_at"];
  const createdAt = row["created_at"];
  if (
    typeof id !== "string" ||
    typeof email !== "string" ||
    (role !== "operator" && role !== "reviewer" && role !== "viewer") ||
    (status !== "pending" &&
      status !== "accepted" &&
      status !== "revoked" &&
      status !== "expired") ||
    typeof expiresAt !== "string" ||
    typeof createdAt !== "string"
  ) {
    return null;
  }
  return Object.freeze({ id, email, role, status, expiresAt, createdAt });
}

export class TeamRepository implements TeamRepositoryPort {
  public constructor(private readonly database: D1Database) {}

  public async listOrganizationTeam(
    organizationId: string,
    now: string
  ): Promise<{
    members: readonly TeamMember[];
    invitations: readonly TeamInvitation[];
  }> {
    await this.database
      .prepare(
        "UPDATE organization_team_invitations SET status = 'expired', updated_at = ?2 WHERE organization_id = ?1 AND status = 'pending' AND expires_at <= ?2"
      )
      .bind(organizationId, now)
      .run();
    const [memberResult, invitationResult] = await this.database.batch([
      this.database
        .prepare(
          "SELECT m.user_id, u.email_normalized, m.role, m.created_at FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ?1 ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, m.created_at ASC"
        )
        .bind(organizationId),
      this.database
        .prepare(
          "SELECT id, email_normalized, role, status, expires_at, created_at FROM organization_team_invitations WHERE organization_id = ?1 ORDER BY created_at DESC"
        )
        .bind(organizationId)
    ]);
    const members: TeamMember[] = [];
    const invitations: TeamInvitation[] = [];
    for (const candidate of memberResult?.results ?? []) {
      const item = record(candidate);
      const member = item === null ? null : memberFromRow(item);
      if (member !== null) {
        members.push(member);
      }
    }
    for (const candidate of invitationResult?.results ?? []) {
      const item = record(candidate);
      const invitation = item === null ? null : invitationFromRow(item);
      if (invitation !== null) {
        invitations.push(invitation);
      }
    }
    return Object.freeze({
      members: Object.freeze(members),
      invitations: Object.freeze(invitations)
    });
  }

  public async createTeamInvitation(
    recordInput: CreateTeamInvitationRecord
  ): Promise<TeamInvitationCreateResult> {
    const existingMember = await this.database
      .prepare(
        "SELECT 1 FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ?1 AND u.email_normalized = ?2 LIMIT 1"
      )
      .bind(recordInput.organizationId, recordInput.emailNormalized)
      .first();
    if (existingMember !== null) {
      return Object.freeze({ kind: "already_member" });
    }
    const existingInvitation = await this.database
      .prepare(
        "SELECT 1 FROM organization_team_invitations WHERE organization_id = ?1 AND email_normalized = ?2 AND status = 'pending' LIMIT 1"
      )
      .bind(recordInput.organizationId, recordInput.emailNormalized)
      .first();
    if (existingInvitation !== null) {
      return Object.freeze({ kind: "pending_invitation_exists" });
    }

    await this.database.batch([
      this.database
        .prepare(
          "INSERT INTO organization_team_invitations (id, organization_id, email_normalized, role, token_hash, status, invited_by_user_id, expires_at, accepted_at, accepted_by_user_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, NULL, NULL, ?8, ?8)"
        )
        .bind(
          recordInput.invitationId,
          recordInput.organizationId,
          recordInput.emailNormalized,
          recordInput.role,
          recordInput.tokenHash,
          recordInput.invitedByUserId,
          recordInput.expiresAt,
          recordInput.createdAt
        ),
      this.database
        .prepare(
          "INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, reason_code, created_at) VALUES (?1, ?2, ?3, 'team_invitation_created', 'organization_team_invitation', ?4, ?5, ?6, ?7)"
        )
        .bind(
          crypto.randomUUID(),
          recordInput.organizationId,
          recordInput.invitedByUserId,
          recordInput.invitationId,
          recordInput.requestId,
          recordInput.role,
          recordInput.createdAt
        )
    ]);
    return Object.freeze({ kind: "created" });
  }

  public async acceptTeamInvitation(input: {
    tokenHash: string;
    userId: string;
    userEmailNormalized: string;
    acceptedAt: string;
    requestId: string;
  }): Promise<TeamInvitationAcceptResult> {
    const invitation = await this.database
      .prepare(
        "SELECT id, organization_id, email_normalized, role, status, expires_at FROM organization_team_invitations WHERE token_hash = ?1 LIMIT 1"
      )
      .bind(input.tokenHash)
      .first<Record<string, unknown>>();
    if (invitation === null) {
      return Object.freeze({ kind: "missing" });
    }
    const id = invitation["id"];
    const organizationId = invitation["organization_id"];
    const email = invitation["email_normalized"];
    const role = invitation["role"];
    const status = invitation["status"];
    const expiresAt = invitation["expires_at"];
    if (
      typeof id !== "string" ||
      typeof organizationId !== "string" ||
      typeof email !== "string" ||
      (role !== "operator" && role !== "reviewer" && role !== "viewer") ||
      typeof status !== "string" ||
      typeof expiresAt !== "string"
    ) {
      return Object.freeze({ kind: "missing" });
    }
    if (email !== input.userEmailNormalized) {
      return Object.freeze({ kind: "not_recipient" });
    }
    if (status === "accepted") {
      return Object.freeze({ kind: "already_accepted" });
    }
    if (status === "revoked") {
      return Object.freeze({ kind: "revoked" });
    }
    if (status === "expired" || expiresAt <= input.acceptedAt) {
      await this.database
        .prepare(
          "UPDATE organization_team_invitations SET status = 'expired', updated_at = ?2 WHERE id = ?1 AND status = 'pending'"
        )
        .bind(id, input.acceptedAt)
        .run();
      return Object.freeze({ kind: "expired" });
    }

    await this.database.batch([
      this.database
        .prepare(
          "INSERT INTO organization_members (organization_id, user_id, role, created_at) SELECT ?1, ?2, ?3, ?4 WHERE NOT EXISTS (SELECT 1 FROM organization_members WHERE organization_id = ?1 AND user_id = ?2)"
        )
        .bind(organizationId, input.userId, role, input.acceptedAt),
      this.database
        .prepare(
          "UPDATE organization_team_invitations SET status = 'accepted', accepted_at = ?2, accepted_by_user_id = ?3, updated_at = ?2 WHERE id = ?1 AND status = 'pending'"
        )
        .bind(id, input.acceptedAt, input.userId),
      this.database
        .prepare(
          "INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, reason_code, created_at) VALUES (?1, ?2, ?3, 'team_invitation_accepted', 'organization_team_invitation', ?4, ?5, ?6, ?7)"
        )
        .bind(
          crypto.randomUUID(),
          organizationId,
          input.userId,
          id,
          input.requestId,
          role,
          input.acceptedAt
        )
    ]);
    return Object.freeze({ kind: "accepted", organizationId });
  }

  public async updateMemberRole(input: {
    organizationId: string;
    userId: string;
    role: OrganizationRole;
    updatedByUserId: string;
    updatedAt: string;
    requestId: string;
  }): Promise<TeamMemberMutationResult> {
    const member = await this.database
      .prepare("SELECT role FROM organization_members WHERE organization_id = ?1 AND user_id = ?2")
      .bind(input.organizationId, input.userId)
      .first<Record<string, unknown>>();
    if (member === null || typeof member["role"] !== "string") {
      return Object.freeze({ kind: "member_missing" });
    }
    if (member["role"] === "owner" && input.role !== "owner") {
      const ownerCount = await this.database
        .prepare(
          "SELECT COUNT(*) AS total FROM organization_members WHERE organization_id = ?1 AND role = 'owner'"
        )
        .bind(input.organizationId)
        .first<Record<string, unknown>>();
      if (ownerCount?.["total"] === 1) {
        return Object.freeze({ kind: "last_owner_protected" });
      }
    }
    await this.database.batch([
      this.database
        .prepare(
          "UPDATE organization_members SET role = ?3 WHERE organization_id = ?1 AND user_id = ?2"
        )
        .bind(input.organizationId, input.userId, input.role),
      this.database
        .prepare(
          "INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, reason_code, created_at) VALUES (?1, ?2, ?3, 'team_member_role_updated', 'organization_member', ?4, ?5, ?6, ?7)"
        )
        .bind(
          crypto.randomUUID(),
          input.organizationId,
          input.updatedByUserId,
          input.userId,
          input.requestId,
          input.role,
          input.updatedAt
        )
    ]);
    return Object.freeze({ kind: "updated" });
  }

  public async removeMember(input: {
    organizationId: string;
    userId: string;
    removedByUserId: string;
    removedAt: string;
    requestId: string;
  }): Promise<TeamMemberMutationResult> {
    const member = await this.database
      .prepare("SELECT role FROM organization_members WHERE organization_id = ?1 AND user_id = ?2")
      .bind(input.organizationId, input.userId)
      .first<Record<string, unknown>>();
    if (member === null || typeof member["role"] !== "string") {
      return Object.freeze({ kind: "member_missing" });
    }
    if (member["role"] === "owner") {
      const ownerCount = await this.database
        .prepare(
          "SELECT COUNT(*) AS total FROM organization_members WHERE organization_id = ?1 AND role = 'owner'"
        )
        .bind(input.organizationId)
        .first<Record<string, unknown>>();
      if (ownerCount?.["total"] === 1) {
        return Object.freeze({ kind: "last_owner_protected" });
      }
    }
    await this.database.batch([
      this.database
        .prepare("DELETE FROM organization_members WHERE organization_id = ?1 AND user_id = ?2")
        .bind(input.organizationId, input.userId),
      this.database
        .prepare(
          "UPDATE user_sessions SET revoked_at = ?3 WHERE organization_id = ?1 AND user_id = ?2 AND revoked_at IS NULL"
        )
        .bind(input.organizationId, input.userId, input.removedAt),
      this.database
        .prepare(
          "INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, request_id, reason_code, created_at) VALUES (?1, ?2, ?3, 'team_member_removed', 'organization_member', ?4, ?5, 'membership_revoked', ?6)"
        )
        .bind(
          crypto.randomUUID(),
          input.organizationId,
          input.removedByUserId,
          input.userId,
          input.requestId,
          input.removedAt
        )
    ]);
    return Object.freeze({ kind: "removed" });
  }
}

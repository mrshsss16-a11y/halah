import type {
  OrganizationRole,
  TeamAssignableRole,
  TeamInvitation,
  TeamMember
} from "@hala/contracts";

export type CreateTeamInvitationRecord = Readonly<{
  invitationId: string;
  organizationId: string;
  emailNormalized: string;
  role: TeamAssignableRole;
  tokenHash: string;
  invitedByUserId: string;
  expiresAt: string;
  createdAt: string;
  requestId: string;
}>;

export type TeamInvitationCreateResult =
  | Readonly<{ kind: "created" }>
  | Readonly<{ kind: "already_member" }>
  | Readonly<{ kind: "pending_invitation_exists" }>;

export type TeamInvitationAcceptResult =
  | Readonly<{ kind: "accepted"; organizationId: string }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "expired" }>
  | Readonly<{ kind: "not_recipient" }>
  | Readonly<{ kind: "already_accepted" }>
  | Readonly<{ kind: "revoked" }>;

export type TeamMemberMutationResult =
  | Readonly<{ kind: "updated" }>
  | Readonly<{ kind: "removed" }>
  | Readonly<{ kind: "member_missing" }>
  | Readonly<{ kind: "last_owner_protected" }>;

export interface TeamRepositoryPort {
  listOrganizationTeam(
    organizationId: string,
    now: string
  ): Promise<{
    members: readonly TeamMember[];
    invitations: readonly TeamInvitation[];
  }>;
  createTeamInvitation(record: CreateTeamInvitationRecord): Promise<TeamInvitationCreateResult>;
  acceptTeamInvitation(input: {
    tokenHash: string;
    userId: string;
    userEmailNormalized: string;
    acceptedAt: string;
    requestId: string;
  }): Promise<TeamInvitationAcceptResult>;
  updateMemberRole(input: {
    organizationId: string;
    userId: string;
    role: OrganizationRole;
    updatedByUserId: string;
    updatedAt: string;
    requestId: string;
  }): Promise<TeamMemberMutationResult>;
  removeMember(input: {
    organizationId: string;
    userId: string;
    removedByUserId: string;
    removedAt: string;
    requestId: string;
  }): Promise<TeamMemberMutationResult>;
}

import type {
  OrganizationRole,
  TeamInvitationCreate,
  TeamInvitationAccept,
  TeamMemberRoleUpdate
} from "@hala/contracts";
import { hashSessionToken, issueSessionToken } from "../../security/session-token";
import type {
  TeamInvitationAcceptResult,
  TeamInvitationCreateResult,
  TeamMemberMutationResult,
  TeamRepositoryPort
} from "./team-repository-port";

const INVITATION_DURATION_MS = 1000 * 60 * 60 * 24 * 7;

export type IssuedTeamInvitation = Readonly<{
  token: string;
  expiresAt: string;
}>;

export class TeamLifecycleService {
  public constructor(
    private readonly repository: TeamRepositoryPort,
    private readonly clock: () => Date = () => new Date()
  ) {}

  public async list(organizationId: string) {
    return this.repository.listOrganizationTeam(organizationId, this.clock().toISOString());
  }

  public async createInvitation(
    organizationId: string,
    invitedByUserId: string,
    requestId: string,
    input: TeamInvitationCreate
  ): Promise<Readonly<{ outcome: TeamInvitationCreateResult; invitation?: IssuedTeamInvitation }>> {
    const now = this.clock();
    const issuedToken = await issueSessionToken();
    const expiresAt = new Date(now.getTime() + INVITATION_DURATION_MS).toISOString();
    const outcome = await this.repository.createTeamInvitation({
      invitationId: crypto.randomUUID(),
      organizationId,
      emailNormalized: input.email,
      role: input.role,
      tokenHash: issuedToken.tokenHash,
      invitedByUserId,
      expiresAt,
      createdAt: now.toISOString(),
      requestId
    });
    if (outcome.kind !== "created") {
      return Object.freeze({ outcome });
    }

    return Object.freeze({
      outcome,
      invitation: Object.freeze({ token: issuedToken.rawToken, expiresAt })
    });
  }

  public async acceptInvitation(
    userId: string,
    userEmailNormalized: string,
    requestId: string,
    input: TeamInvitationAccept
  ): Promise<TeamInvitationAcceptResult> {
    return this.repository.acceptTeamInvitation({
      tokenHash: await hashSessionToken(input.token),
      userId,
      userEmailNormalized,
      acceptedAt: this.clock().toISOString(),
      requestId
    });
  }

  public async updateMemberRole(
    organizationId: string,
    userId: string,
    updatedByUserId: string,
    requestId: string,
    input: TeamMemberRoleUpdate
  ): Promise<TeamMemberMutationResult> {
    return this.repository.updateMemberRole({
      organizationId,
      userId,
      role: input.role,
      updatedByUserId,
      updatedAt: this.clock().toISOString(),
      requestId
    });
  }

  public async removeMember(
    organizationId: string,
    userId: string,
    removedByUserId: string,
    requestId: string
  ): Promise<TeamMemberMutationResult> {
    return this.repository.removeMember({
      organizationId,
      userId,
      removedByUserId,
      removedAt: this.clock().toISOString(),
      requestId
    });
  }

  public static canManageTeam(role: OrganizationRole): boolean {
    return role === "owner";
  }
}

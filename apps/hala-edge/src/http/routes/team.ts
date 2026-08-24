import {
  organizationSwitchSchema,
  teamInvitationAcceptSchema,
  teamInvitationCreateSchema,
  teamMemberRoleUpdateSchema,
  userIdSchema
} from "@hala/contracts";
import { Hono, type Context } from "hono";
import { IdentityRepository } from "../../adapters/d1/identity-repository";
import { TeamRepository } from "../../adapters/d1/team-repository";
import { TeamLifecycleService } from "../../modules/identity/team-lifecycle-service";
import { issueSessionToken } from "../../security/session-token";
import { resolveCurrentSession } from "../current-session";
import { errorResponse } from "../errors";
import { hasTrustedBrowserMutation } from "../request-origin";
import { buildSessionCookie } from "../session-cookie";
import type { HalaEnv } from "../types";

async function readJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function requireOwner(context: Context<HalaEnv>) {
  const identity = await resolveCurrentSession(context);
  if (identity === null) {
    return {
      identity: null,
      response: errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.")
    };
  }
  if (!TeamLifecycleService.canManageTeam(identity.role)) {
    return {
      identity: null,
      response: errorResponse(
        context,
        403,
        "insufficient_role",
        "إدارة الفريق متاحة لمالك المساحة فقط."
      )
    };
  }
  return { identity, response: null };
}

function mutationGuard(context: Context<HalaEnv>): Response | null {
  if (!hasTrustedBrowserMutation(context.req.raw)) {
    return errorResponse(
      context,
      403,
      "invalid_request_origin",
      "تعذر التحقق من مصدر الطلب بشكل آمن."
    );
  }
  return null;
}

export function createTeamRoutes(): Hono<HalaEnv> {
  const team = new Hono<HalaEnv>();

  team.get("/", async (context) => {
    const identity = await resolveCurrentSession(context);
    if (identity === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }
    const organizationTeam = await new TeamLifecycleService(
      new TeamRepository(context.env.DB)
    ).list(identity.organizationId);
    return context.json(organizationTeam);
  });

  team.post("/invitations", async (context) => {
    const guard = mutationGuard(context);
    if (guard !== null) {
      return guard;
    }
    if (context.get("config").environment !== "development") {
      return errorResponse(
        context,
        503,
        "team_invitation_delivery_not_configured",
        "إرسال دعوات الفريق غير مفعّل في هذه البيئة."
      );
    }
    const owner = await requireOwner(context);
    if (owner.response !== null || owner.identity === null) {
      return owner.response;
    }
    const parsed = teamInvitationCreateSchema.safeParse(await readJsonBody(context.req.raw));
    if (!parsed.success) {
      return errorResponse(
        context,
        400,
        "invalid_team_invitation",
        "تحقق من البريد والدور المحدد."
      );
    }
    const outcome = await new TeamLifecycleService(
      new TeamRepository(context.env.DB)
    ).createInvitation(
      owner.identity.organizationId,
      owner.identity.userId,
      context.get("requestId"),
      parsed.data
    );
    if (outcome.outcome.kind === "already_member") {
      return errorResponse(context, 409, "team_member_exists", "هذا البريد عضو بالفعل في المساحة.");
    }
    if (outcome.outcome.kind === "pending_invitation_exists") {
      return errorResponse(context, 409, "team_invitation_pending", "توجد دعوة معلقة لهذا البريد.");
    }
    if (outcome.invitation === undefined) {
      return errorResponse(
        context,
        500,
        "team_invitation_unavailable",
        "تعذر إنشاء الدعوة بشكل آمن."
      );
    }
    return context.json(
      {
        status: "created_local_only",
        invitationToken: outcome.invitation.token,
        expiresAt: outcome.invitation.expiresAt
      },
      201
    );
  });

  team.post("/invitations/accept", async (context) => {
    const guard = mutationGuard(context);
    if (guard !== null) {
      return guard;
    }
    const identity = await resolveCurrentSession(context);
    if (identity === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }
    const parsed = teamInvitationAcceptSchema.safeParse(await readJsonBody(context.req.raw));
    if (!parsed.success) {
      return errorResponse(context, 400, "invalid_team_invitation", "رمز الدعوة غير صالح.");
    }
    const identities = new IdentityRepository(context.env.DB);
    const user = await identities.findUserById(identity.userId);
    if (user === null || user.status !== "active") {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }
    const outcome = await new TeamLifecycleService(
      new TeamRepository(context.env.DB)
    ).acceptInvitation(
      identity.userId,
      user.emailNormalized,
      context.get("requestId"),
      parsed.data
    );
    if (outcome.kind === "missing") {
      return errorResponse(context, 404, "team_invitation_missing", "دعوة الفريق غير موجودة.");
    }
    if (outcome.kind === "not_recipient") {
      return errorResponse(
        context,
        403,
        "team_invitation_recipient_mismatch",
        "هذه الدعوة لا تخص حسابك."
      );
    }
    if (outcome.kind === "expired") {
      return errorResponse(context, 410, "team_invitation_expired", "انتهت صلاحية الدعوة.");
    }
    if (outcome.kind === "revoked") {
      return errorResponse(context, 410, "team_invitation_revoked", "ألغيت هذه الدعوة.");
    }
    if (outcome.kind === "already_accepted") {
      return errorResponse(
        context,
        409,
        "team_invitation_already_accepted",
        "قُبلت هذه الدعوة سابقاً."
      );
    }
    const issuedSession = await issueSessionToken();
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
    await identities.createSession({
      sessionId: crypto.randomUUID(),
      userId: identity.userId,
      organizationId: outcome.organizationId,
      tokenHash: issuedSession.tokenHash,
      expiresAt,
      createdAt: issuedAt
    });
    context.header(
      "set-cookie",
      buildSessionCookie(issuedSession.rawToken, expiresAt, context.get("config").environment)
    );
    return context.json({ status: "accepted", nextPath: "/app" });
  });

  team.patch("/members/:userId", async (context) => {
    const guard = mutationGuard(context);
    if (guard !== null) {
      return guard;
    }
    const owner = await requireOwner(context);
    if (owner.response !== null || owner.identity === null) {
      return owner.response;
    }
    const targetUserId = userIdSchema.safeParse(context.req.param("userId"));
    if (!targetUserId.success) {
      return errorResponse(context, 400, "invalid_team_member", "معرّف العضو غير صالح.");
    }
    const parsed = teamMemberRoleUpdateSchema.safeParse(await readJsonBody(context.req.raw));
    if (!parsed.success) {
      return errorResponse(context, 400, "invalid_team_role", "الدور المحدد غير صالح.");
    }
    const outcome = await new TeamLifecycleService(
      new TeamRepository(context.env.DB)
    ).updateMemberRole(
      owner.identity.organizationId,
      targetUserId.data,
      owner.identity.userId,
      context.get("requestId"),
      parsed.data
    );
    if (outcome.kind === "member_missing") {
      return errorResponse(context, 404, "team_member_missing", "العضو غير موجود في هذه المساحة.");
    }
    if (outcome.kind === "last_owner_protected") {
      return errorResponse(
        context,
        409,
        "last_owner_protected",
        "لا يمكن تغيير دور آخر مالك للمساحة."
      );
    }
    return context.json({ status: "updated" });
  });

  team.delete("/members/:userId", async (context) => {
    const guard = mutationGuard(context);
    if (guard !== null) {
      return guard;
    }
    const owner = await requireOwner(context);
    if (owner.response !== null || owner.identity === null) {
      return owner.response;
    }
    const targetUserId = userIdSchema.safeParse(context.req.param("userId"));
    if (!targetUserId.success) {
      return errorResponse(context, 400, "invalid_team_member", "معرّف العضو غير صالح.");
    }
    const outcome = await new TeamLifecycleService(new TeamRepository(context.env.DB)).removeMember(
      owner.identity.organizationId,
      targetUserId.data,
      owner.identity.userId,
      context.get("requestId")
    );
    if (outcome.kind === "member_missing") {
      return errorResponse(context, 404, "team_member_missing", "العضو غير موجود في هذه المساحة.");
    }
    if (outcome.kind === "last_owner_protected") {
      return errorResponse(context, 409, "last_owner_protected", "لا يمكن إزالة آخر مالك للمساحة.");
    }
    return context.json({ status: "removed" });
  });

  team.post("/switch", async (context) => {
    const guard = mutationGuard(context);
    if (guard !== null) {
      return guard;
    }
    const identity = await resolveCurrentSession(context);
    if (identity === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }
    const parsed = organizationSwitchSchema.safeParse(await readJsonBody(context.req.raw));
    if (!parsed.success) {
      return errorResponse(
        context,
        400,
        "invalid_organization_switch",
        "المساحة المحددة غير صالحة."
      );
    }
    const identities = new IdentityRepository(context.env.DB);
    if (!(await identities.hasActiveMembership(identity.userId, parsed.data.organizationId))) {
      return errorResponse(
        context,
        403,
        "organization_membership_required",
        "لا تملك عضوية نشطة في هذه المساحة."
      );
    }
    const issuedSession = await issueSessionToken();
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
    await identities.createSession({
      sessionId: crypto.randomUUID(),
      userId: identity.userId,
      organizationId: parsed.data.organizationId,
      tokenHash: issuedSession.tokenHash,
      expiresAt,
      createdAt: issuedAt
    });
    context.header(
      "set-cookie",
      buildSessionCookie(issuedSession.rawToken, expiresAt, context.get("config").environment)
    );
    return context.json({ nextPath: "/app" });
  });

  return team;
}

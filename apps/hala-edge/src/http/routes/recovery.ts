import {
  eventIdSchema,
  recoveryLocalIntakeInputSchema,
  recoveryPolicyDraftInputSchema,
  recoverySimulationInputSchema
} from "@hala/contracts";
import { Hono } from "hono";
import { D1RecoveryIntakeRepository } from "../../adapters/d1/recovery-intake-repository";
import { RecoveryPolicyRepository } from "../../adapters/d1/recovery-policy-repository";
import { RecoveryIntakeService } from "../../modules/recovery/recovery-intake-service";
import { RecoveryPolicyService } from "../../modules/recovery/recovery-policy-service";
import { simulateRecoveryEligibility } from "../../modules/recovery/simulate-eligibility";
import { resolveCurrentSession } from "../current-session";
import { errorResponse } from "../errors";
import { hasTrustedBrowserMutation } from "../request-origin";
import type { HalaEnv } from "../types";

async function readJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function createRecoveryRoutes(): Hono<HalaEnv> {
  const recovery = new Hono<HalaEnv>();

  recovery.get("/policies", async (context) => {
    const identity = await resolveCurrentSession(context);
    if (identity === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }
    const policies = await new RecoveryPolicyService(
      new RecoveryPolicyRepository(context.env.DB)
    ).list(identity.organizationId);
    return context.json({ items: policies });
  });

  recovery.post("/policies", async (context) => {
    if (!hasTrustedBrowserMutation(context.req.raw)) {
      return errorResponse(
        context,
        403,
        "invalid_request_origin",
        "تعذر التحقق من مصدر الطلب بشكل آمن."
      );
    }
    const identity = await resolveCurrentSession(context);
    if (identity === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }
    if (identity.role !== "owner") {
      return errorResponse(
        context,
        403,
        "insufficient_role",
        "إصدار سياسة الاسترداد متاح لمالك المساحة فقط."
      );
    }
    const parsed = recoveryPolicyDraftInputSchema.safeParse(await readJsonBody(context.req.raw));
    if (!parsed.success) {
      return errorResponse(
        context,
        400,
        "invalid_recovery_policy",
        "تحقق من حدود سياسة الاسترداد."
      );
    }
    const policy = await new RecoveryPolicyService(
      new RecoveryPolicyRepository(context.env.DB)
    ).createDraft(identity.organizationId, identity.userId, parsed.data);
    return context.json({ policy }, 201);
  });

  recovery.post("/policies/:policyId/activate", async (context) => {
    if (!hasTrustedBrowserMutation(context.req.raw)) {
      return errorResponse(
        context,
        403,
        "invalid_request_origin",
        "تعذر التحقق من مصدر الطلب بشكل آمن."
      );
    }
    const identity = await resolveCurrentSession(context);
    if (identity === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }
    if (identity.role !== "owner") {
      return errorResponse(
        context,
        403,
        "insufficient_role",
        "اعتماد سياسة الاسترداد متاح لمالك المساحة فقط."
      );
    }
    const policyId = eventIdSchema.safeParse(context.req.param("policyId"));
    if (!policyId.success) {
      return errorResponse(context, 400, "invalid_recovery_policy", "معرّف السياسة غير صالح.");
    }
    const outcome = await new RecoveryPolicyService(
      new RecoveryPolicyRepository(context.env.DB)
    ).activate(identity.organizationId, policyId.data, identity.userId, context.get("requestId"));
    if (outcome === "missing") {
      return errorResponse(
        context,
        404,
        "recovery_policy_missing",
        "السياسة غير موجودة في هذه المساحة."
      );
    }
    if (outcome === "not_draft") {
      return errorResponse(
        context,
        409,
        "recovery_policy_not_draft",
        "لا يمكن اعتماد هذه السياسة بحالتها الحالية."
      );
    }
    return context.json({ status: "activated" });
  });

  recovery.post("/simulate", async (context) => {
    if (!hasTrustedBrowserMutation(context.req.raw)) {
      return errorResponse(
        context,
        403,
        "invalid_request_origin",
        "تعذر التحقق من مصدر الطلب بشكل آمن."
      );
    }

    const identity = await resolveCurrentSession(context);
    if (identity === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }

    const payload = await readJsonBody(context.req.raw);
    const parsed = recoverySimulationInputSchema.safeParse(payload);
    if (!parsed.success) {
      return errorResponse(
        context,
        400,
        "invalid_recovery_simulation",
        "تحقق من خيارات المحاكاة قبل تشغيلها."
      );
    }

    return context.json({ result: simulateRecoveryEligibility(parsed.data) });
  });

  recovery.post("/intake/local", async (context) => {
    if (context.get("config").environment !== "development") {
      return errorResponse(
        context,
        503,
        "recovery_intake_not_configured",
        "استقبال الاسترداد المحلي غير مفعّل في هذه البيئة."
      );
    }
    if (!hasTrustedBrowserMutation(context.req.raw)) {
      return errorResponse(
        context,
        403,
        "invalid_request_origin",
        "تعذر التحقق من مصدر الطلب بشكل آمن."
      );
    }

    const identity = await resolveCurrentSession(context);
    if (identity === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }
    if (identity.role === "viewer") {
      return errorResponse(context, 403, "insufficient_role", "لا تملك صلاحية إدارة الاسترداد.");
    }

    const payload = await readJsonBody(context.req.raw);
    const parsed = recoveryLocalIntakeInputSchema.safeParse(payload);
    if (!parsed.success) {
      return errorResponse(
        context,
        400,
        "invalid_recovery_intake",
        "بيانات الاسترداد المحلية غير صالحة."
      );
    }

    const outcome = await new RecoveryIntakeService(
      new D1RecoveryIntakeRepository(context.env.DB)
    ).receive({
      organizationId: identity.organizationId,
      externalCartId: parsed.data.externalCartId,
      contactHash: parsed.data.contactHash,
      requestId: context.get("requestId")
    });
    if (outcome.kind === "invalid_input") {
      return errorResponse(
        context,
        400,
        "invalid_recovery_intake",
        "بيانات الاسترداد المحلية غير صالحة."
      );
    }
    if (outcome.kind === "duplicate") {
      return context.json({ status: "duplicate" }, 202);
    }

    return context.json({ status: "received", recoveryCaseId: outcome.recoveryCaseId }, 201);
  });

  return recovery;
}

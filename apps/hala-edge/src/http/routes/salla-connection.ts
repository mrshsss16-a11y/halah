import { sallaOAuthMockCompletionInputSchema } from "@hala/contracts";
import { Hono } from "hono";
import { D1SallaConnectionRepository } from "../../adapters/d1/salla-connection-repository";
import { D1SallaOAuthStateRepository } from "../../adapters/d1/salla-oauth-state-repository";
import { SallaConnectionService } from "../../modules/salla/salla-connection-service";
import { SallaOAuthStateService } from "../../modules/salla/salla-oauth-state-service";
import { canManageStoreConnection } from "../commercial-authorization";
import { resolveCurrentSession } from "../current-session";
import { errorResponse } from "../errors";
import { hasTrustedSameOrigin } from "../request-origin";
import type { HalaEnv } from "../types";

async function readJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function createConnectionService(database: D1Database): SallaConnectionService {
  return new SallaConnectionService(
    new SallaOAuthStateService(new D1SallaOAuthStateRepository(database)),
    new D1SallaConnectionRepository(database)
  );
}

export function createSallaConnectionRoutes(): Hono<HalaEnv> {
  const connection = new Hono<HalaEnv>();

  connection.use("*", async (context, next) => {
    if (context.get("config").environment !== "development") {
      return errorResponse(
        context,
        503,
        "salla_connection_not_configured",
        "ربط سلة المحلي غير مفعّل في هذه البيئة."
      );
    }
    if (!hasTrustedSameOrigin(context.req.raw)) {
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
    if (!canManageStoreConnection(identity.role)) {
      return errorResponse(
        context,
        403,
        "insufficient_role",
        "هذه العملية متاحة لمالك المنظمة فقط."
      );
    }

    context.set("sallaConnectionIdentity", identity);
    return next();
  });

  connection.post("/salla/mock/start", async (context) => {
    const identity = context.get("sallaConnectionIdentity");
    const outcome = await createConnectionService(context.env.DB).startLocalAuthorization({
      organizationId: identity.organizationId
    });

    return context.json(
      {
        status: outcome.kind,
        state: outcome.state,
        expiresAt: outcome.expiresAt,
        mode: "local_mock"
      },
      201
    );
  });

  connection.post("/salla/mock/complete", async (context) => {
    const payload = await readJsonBody(context.req.raw);
    const parsed = sallaOAuthMockCompletionInputSchema.safeParse(payload);
    if (!parsed.success) {
      return errorResponse(
        context,
        400,
        "invalid_salla_oauth_state",
        "بيانات إكمال الربط المحلي غير صالحة."
      );
    }

    const outcome = await createConnectionService(context.env.DB).completeLocalAuthorization(
      parsed.data.state
    );
    if (outcome.kind === "state_rejected") {
      return errorResponse(
        context,
        400,
        "salla_oauth_state_rejected",
        "رمز ربط سلة غير صالح أو منتهٍ."
      );
    }
    if (outcome.kind === "state_already_consumed") {
      return errorResponse(
        context,
        409,
        "salla_oauth_state_already_consumed",
        "استُخدم رمز ربط سلة مسبقاً."
      );
    }
    if (outcome.kind === "connection_not_authorizing") {
      return errorResponse(
        context,
        409,
        "salla_connection_not_authorizing",
        "حالة اتصال سلة لا تسمح بإكمال الربط المحلي."
      );
    }

    return context.json({ status: outcome.kind, mode: "local_mock" }, 200);
  });

  return connection;
}

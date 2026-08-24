import { recoverySimulationInputSchema } from "@hala/contracts";
import { Hono } from "hono";
import { simulateRecoveryEligibility } from "../../modules/recovery/simulate-eligibility";
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

export function createRecoveryRoutes(): Hono<HalaEnv> {
  const recovery = new Hono<HalaEnv>();

  recovery.post("/simulate", async (context) => {
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

  return recovery;
}

import { activationRequestInputSchema } from "@hala/contracts";
import { Hono } from "hono";
import { CommercialRepository } from "../../adapters/d1/commercial-repository";
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

export function createActivationRoutes(): Hono<HalaEnv> {
  const activation = new Hono<HalaEnv>();

  activation.post("/request", async (context) => {
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
    const parsed = activationRequestInputSchema.safeParse(payload);
    if (!parsed.success) {
      return errorResponse(
        context,
        400,
        "invalid_activation_request",
        "اختر الخدمة وأضف ملاحظة مختصرة عند الحاجة."
      );
    }

    const repository = new CommercialRepository(context.env.DB);
    await repository.submitActivationRequest({
      id: crypto.randomUUID(),
      organizationId: identity.organizationId,
      userId: identity.userId,
      requestedService: parsed.data.requestedService,
      notes: parsed.data.notes,
      createdAt: new Date().toISOString()
    });

    return context.json({ status: "submitted" }, 201);
  });

  return activation;
}

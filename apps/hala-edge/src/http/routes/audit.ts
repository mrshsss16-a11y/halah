import { auditEventListResponseSchema, auditEventQuerySchema } from "@hala/contracts";
import { Hono } from "hono";
import { AuditRepository } from "../../adapters/d1/audit-repository";
import { resolveCurrentSession } from "../current-session";
import { errorResponse } from "../errors";
import type { HalaEnv } from "../types";

export function createAuditRoutes(): Hono<HalaEnv> {
  const audit = new Hono<HalaEnv>();

  audit.get("/", async (context) => {
    const identity = await resolveCurrentSession(context);
    if (identity === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }

    const parsed = auditEventQuerySchema.safeParse({
      page: context.req.query("page"),
      pageSize: context.req.query("pageSize"),
      action: context.req.query("action")
    });
    if (!parsed.success) {
      return errorResponse(context, 400, "invalid_audit_query", "تحقق من رقم الصفحة والفلتر.");
    }

    const result = await new AuditRepository(context.env.DB).listOrganizationEvents(
      identity.organizationId,
      parsed.data
    );
    return context.json(
      auditEventListResponseSchema.parse({
        ...result,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        action: parsed.data.action ?? null
      })
    );
  });

  return audit;
}

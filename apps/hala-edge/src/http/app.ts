import { parseRuntimeConfig } from "@hala/config";
import { healthResponseSchema } from "@hala/contracts";
import { Hono } from "hono";
import { errorResponse } from "./errors";
import type { HalaEnv } from "./types";
import { resolveRequestId } from "../security/request-id";
import { createActivationRoutes } from "./routes/activation";
import { createAuthRoutes } from "./routes/auth";
import { createProductContentRoutes } from "./routes/product-content";
import { createRecoveryRoutes } from "./routes/recovery";
import { createUiRoutes } from "./routes/ui";

export function createApp(): Hono<HalaEnv> {
  const app = new Hono<HalaEnv>();

  app.use("*", async (context, next) => {
    const requestId = resolveRequestId(context.req.header("x-request-id"));
    const config = parseRuntimeConfig({
      ENVIRONMENT: context.env.ENVIRONMENT,
      APP_VERSION: context.env.APP_VERSION
    });

    context.set("requestId", requestId);
    context.set("config", config);
    context.header("x-request-id", requestId);

    await next();
  });

  app.route("/api/auth", createAuthRoutes());
  app.route("/api/activation", createActivationRoutes());
  app.route("/api/product-content", createProductContentRoutes());
  app.route("/api/recovery", createRecoveryRoutes());
  app.route("/", createUiRoutes());

  app.get("/health", (context) => {
    const config = context.get("config");
    const body = healthResponseSchema.parse({
      status: "ok",
      environment: config.environment,
      requestId: context.get("requestId"),
      version: config.appVersion
    });

    return context.json(body, 200);
  });

  app.notFound((context) => errorResponse(context, 404, "not_found", "المسار المطلوب غير موجود."));

  app.onError((error, context) => {
    console.error({
      event: "unhandled_http_error",
      requestId: context.get("requestId"),
      errorName: error.name
    });

    return errorResponse(context, 500, "internal_error", "تعذر إكمال الطلب بشكل آمن.");
  });

  return app;
}

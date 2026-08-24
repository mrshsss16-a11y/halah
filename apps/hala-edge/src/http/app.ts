import { parseRuntimeConfig } from "@hala/config";
import { healthResponseSchema } from "@hala/contracts";
import { Hono } from "hono";
import { errorResponse } from "./errors";
import type { HalaEnv } from "./types";
import { createCsrfToken, buildCsrfCookie } from "../security/csrf";
import { resolveRequestId } from "../security/request-id";
import { createActivationRoutes } from "./routes/activation";
import { createAuditRoutes } from "./routes/audit";
import { createAuthRoutes } from "./routes/auth";
import { createProductContentRoutes } from "./routes/product-content";
import { createRecoveryRoutes } from "./routes/recovery";
import { createSallaConnectionRoutes } from "./routes/salla-connection";
import { createTeamRoutes } from "./routes/team";
import { createSallaWebhookRoutes } from "./routes/salla-webhook";
import { createUiRoutes } from "./routes/ui";

function createCspNonce(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function createApp(): Hono<HalaEnv> {
  const app = new Hono<HalaEnv>();

  app.use("*", async (context, next) => {
    const requestId = resolveRequestId(context.req.header("x-request-id"));
    const cspNonce = createCspNonce();
    const config = parseRuntimeConfig({
      ENVIRONMENT: context.env.ENVIRONMENT,
      APP_VERSION: context.env.APP_VERSION
    });

    context.set("requestId", requestId);
    context.set("cspNonce", cspNonce);
    context.set("config", config);
    context.header("x-request-id", requestId);
    if (context.req.method === "GET") {
      context.header("set-cookie", buildCsrfCookie(createCsrfToken(), config.environment));
    }
    context.header("x-content-type-options", "nosniff");
    context.header("referrer-policy", "strict-origin-when-cross-origin");
    context.header("x-frame-options", "DENY");
    context.header("permissions-policy", "geolocation=(), camera=(), microphone=()");
    context.header(
      "content-security-policy",
      `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'nonce-${cspNonce}'; connect-src 'self'; img-src 'self' data:; font-src 'self'`
    );

    await next();
  });

  app.route("/api/auth", createAuthRoutes());
  app.route("/api/audit-events", createAuditRoutes());
  app.route("/api/activation", createActivationRoutes());
  app.route("/api/product-content", createProductContentRoutes());
  app.route("/api/recovery", createRecoveryRoutes());
  app.route("/api/team", createTeamRoutes());
  app.route("/api/connections", createSallaConnectionRoutes());
  app.route("/webhooks/salla", createSallaWebhookRoutes());
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

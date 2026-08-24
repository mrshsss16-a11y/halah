import { loginInputSchema, signUpInputSchema } from "@hala/contracts";
import { Hono, type Context } from "hono";
import { IdentityRepository } from "../../adapters/d1/identity-repository";
import { KvAuthAttemptGuard } from "../../adapters/kv/auth-attempt-guard";
import { IdentityService } from "../../modules/identity/identity-service";
import { hashSessionToken } from "../../security/session-token";
import { errorResponse } from "../errors";
import { hasTrustedSameOrigin } from "../request-origin";
import { buildExpiredSessionCookie, buildSessionCookie, readSessionToken } from "../session-cookie";
import type { HalaEnv } from "../types";

async function readJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function consumeAuthAttempt(
  context: Context<HalaEnv>,
  operation: "login" | "signup",
  email: string
): Promise<Response | null> {
  const outcome = await new KvAuthAttemptGuard(context.env.AUTH_RATE_LIMIT).consume({
    operation,
    email,
    clientAddress: context.req.header("cf-connecting-ip") ?? "unknown"
  });
  if (outcome.kind === "allowed") {
    return null;
  }
  if (outcome.kind === "limited") {
    context.header("retry-after", String(outcome.retryAfterSeconds));
    return errorResponse(
      context,
      429,
      "auth_attempts_limited",
      "انتظر قليلاً قبل محاولة التسجيل أو الدخول مرة أخرى."
    );
  }

  return errorResponse(
    context,
    503,
    "auth_guard_unavailable",
    "تعذر التحقق الآمن من المحاولة الآن."
  );
}

export function createAuthRoutes(): Hono<HalaEnv> {
  const auth = new Hono<HalaEnv>();

  auth.post("/signup", async (context) => {
    if (!hasTrustedSameOrigin(context.req.raw)) {
      return errorResponse(
        context,
        403,
        "invalid_request_origin",
        "تعذر التحقق من مصدر الطلب بشكل آمن."
      );
    }

    const payload = await readJsonBody(context.req.raw);
    const parsed = signUpInputSchema.safeParse(payload);
    if (!parsed.success) {
      return errorResponse(
        context,
        400,
        "invalid_signup",
        "تحقق من البريد وكلمة المرور واسم المساحة."
      );
    }

    const rateLimitResponse = await consumeAuthAttempt(context, "signup", parsed.data.email);
    if (rateLimitResponse !== null) {
      return rateLimitResponse;
    }

    const repository = new IdentityRepository(context.env.DB);
    const service = new IdentityService(repository);
    const outcome = await service.signUp(parsed.data);
    if (outcome.kind === "email_taken") {
      return errorResponse(
        context,
        409,
        "email_already_registered",
        "هذا البريد مسجل بالفعل. سجل دخولك للمتابعة."
      );
    }

    context.header(
      "set-cookie",
      buildSessionCookie(
        outcome.session.rawToken,
        outcome.session.expiresAt,
        context.get("config").environment
      )
    );
    return context.json({ nextPath: "/app" }, 201);
  });

  auth.post("/login", async (context) => {
    if (!hasTrustedSameOrigin(context.req.raw)) {
      return errorResponse(
        context,
        403,
        "invalid_request_origin",
        "تعذر التحقق من مصدر الطلب بشكل آمن."
      );
    }

    const payload = await readJsonBody(context.req.raw);
    const parsed = loginInputSchema.safeParse(payload);
    if (!parsed.success) {
      return errorResponse(context, 400, "invalid_login", "تحقق من البريد وكلمة المرور.");
    }

    const rateLimitResponse = await consumeAuthAttempt(context, "login", parsed.data.email);
    if (rateLimitResponse !== null) {
      return rateLimitResponse;
    }

    const repository = new IdentityRepository(context.env.DB);
    const service = new IdentityService(repository);
    const outcome = await service.login(parsed.data);
    if (outcome.kind === "invalid_credentials") {
      return errorResponse(context, 401, "invalid_credentials", "بيانات الدخول غير صحيحة.");
    }

    context.header(
      "set-cookie",
      buildSessionCookie(
        outcome.session.rawToken,
        outcome.session.expiresAt,
        context.get("config").environment
      )
    );
    return context.json({ nextPath: "/app" }, 200);
  });

  auth.post("/logout", async (context) => {
    if (!hasTrustedSameOrigin(context.req.raw)) {
      return errorResponse(
        context,
        403,
        "invalid_request_origin",
        "تعذر التحقق من مصدر الطلب بشكل آمن."
      );
    }

    const rawToken = readSessionToken(context.req.header("cookie"));
    if (rawToken !== null) {
      const repository = new IdentityRepository(context.env.DB);
      await repository.revokeSession(await hashSessionToken(rawToken), new Date().toISOString());
    }

    context.header("set-cookie", buildExpiredSessionCookie(context.get("config").environment));
    return context.body(null, 204);
  });

  auth.get("/me", async (context) => {
    const rawToken = readSessionToken(context.req.header("cookie"));
    if (rawToken === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }

    const repository = new IdentityRepository(context.env.DB);
    const identity = await repository.findActiveSession(
      await hashSessionToken(rawToken),
      new Date().toISOString()
    );
    if (identity === null) {
      return errorResponse(context, 401, "not_authenticated", "سجل دخولك للمتابعة.");
    }

    return context.json({
      userId: identity.userId,
      organizationId: identity.organizationId,
      organizationName: identity.organizationName,
      role: identity.role,
      expiresAt: identity.expiresAt
    });
  });

  return auth;
}

import { describe, expect, it } from "vitest";
import { createApp } from "../../src/http/app";

const unavailableKv = {
  async get(): Promise<never> {
    throw new Error("KV unavailable");
  }
};

const testEnv = {
  ENVIRONMENT: "development" as const,
  APP_VERSION: "0.1.0-test",
  DB: {} as D1Database,
  AUTH_RATE_LIMIT: unavailableKv as unknown as KVNamespace
};

const sameOriginJsonHeaders = {
  "content-type": "application/json",
  origin: "https://hala.test"
};

describe("commercial HTTP guards", () => {
  it("rejects a state-changing request without a trusted same-origin header", async () => {
    const app = createApp();
    const response = await app.request(
      "https://hala.test/api/auth/signup",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationName: "متجر اختبار",
          email: "owner@example.test",
          password: "TestOnlyPassword-2026"
        })
      },
      testEnv
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_request_origin" }
    });
  });

  it("rejects a malformed signup without touching persistence", async () => {
    const app = createApp();
    const response = await app.request(
      "https://hala.test/api/auth/signup",
      {
        method: "POST",
        headers: sameOriginJsonHeaders,
        body: JSON.stringify({ organizationName: "", email: "not-an-email", password: "short" })
      },
      testEnv
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_signup", message: "تحقق من البريد وكلمة المرور واسم المساحة." }
    });
  });

  it("rejects a malformed login without touching persistence", async () => {
    const app = createApp();
    const response = await app.request(
      "https://hala.test/api/auth/login",
      {
        method: "POST",
        headers: sameOriginJsonHeaders,
        body: JSON.stringify({ email: "owner@example.test" })
      },
      testEnv
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_login", message: "تحقق من البريد وكلمة المرور." }
    });
  });

  it("does not disclose an identity through the session endpoint without a cookie", async () => {
    const app = createApp();
    const response = await app.request("https://hala.test/api/auth/me", undefined, testEnv);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_authenticated" } });
  });

  it("fails closed when the auth rate-limit guard is unavailable", async () => {
    const app = createApp();
    const response = await app.request(
      "https://hala.test/api/auth/login",
      {
        method: "POST",
        headers: sameOriginJsonHeaders,
        body: JSON.stringify({
          email: "owner@example.test",
          password: "TestOnlyPassword-2026"
        })
      },
      testEnv
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "auth_guard_unavailable" }
    });
  });

  it("renders auth forms as POST-only and authorizes only their request nonce", async () => {
    const app = createApp();
    const [signupResponse, loginResponse] = await Promise.all([
      app.request("https://hala.test/signup", undefined, testEnv),
      app.request("https://hala.test/login", undefined, testEnv)
    ]);
    const signupCsp = signupResponse.headers.get("content-security-policy");
    const loginCsp = loginResponse.headers.get("content-security-policy");
    const signupHtml = await signupResponse.text();
    const loginHtml = await loginResponse.text();
    const signupNonce = signupCsp?.match(/'nonce-([^']+)'/)?.[1];
    const loginNonce = loginCsp?.match(/'nonce-([^']+)'/)?.[1];

    expect(signupResponse.status).toBe(200);
    expect(loginResponse.status).toBe(200);
    expect(signupCsp).toContain("script-src 'self' 'nonce-");
    expect(loginCsp).toContain("script-src 'self' 'nonce-");
    expect(signupNonce).toBeTruthy();
    expect(loginNonce).toBeTruthy();
    expect(signupNonce).not.toBe(loginNonce);
    expect(signupHtml).toContain('<form id="signup-form" method="post" action="/api/auth/signup">');
    expect(loginHtml).toContain('<form id="login-form" method="post" action="/api/auth/login">');
    expect(signupHtml).toContain(`nonce="${signupNonce}"`);
    expect(loginHtml).toContain(`nonce="${loginNonce}"`);
    expect(signupHtml).not.toContain('action="/signup"');
    expect(loginHtml).not.toContain('action="/login"');
  });

  it("redirects an unauthenticated merchant page request to login", async () => {
    const app = createApp();
    const dashboardResponse = await app.request("https://hala.test/app", undefined, testEnv);
    const productsResponse = await app.request(
      "https://hala.test/app/products",
      undefined,
      testEnv
    );

    expect(dashboardResponse.status).toBe(302);
    expect(dashboardResponse.headers.get("location")).toBe("https://hala.test/login");
    expect(productsResponse.status).toBe(302);
    expect(productsResponse.headers.get("location")).toBe("https://hala.test/login");
  });
});

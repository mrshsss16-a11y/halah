import { describe, expect, it } from "vitest";
import { createApp } from "../../src/http/app";

const testEnv = {
  ENVIRONMENT: "development" as const,
  APP_VERSION: "0.1.0-test",
  DB: {} as D1Database
};

describe("Hala HTTP application", () => {
  it("returns an explicit health payload and a request ID", async () => {
    const app = createApp();
    const response = await app.request("https://hala.test/health", undefined, testEnv);
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(body).toEqual({
      status: "ok",
      environment: "development",
      requestId: response.headers.get("x-request-id"),
      version: "0.1.0-test"
    });
  });

  it("rejects an unauthenticated preview CSV download before it accesses product data", async () => {
    const app = createApp();
    const response = await app.request(
      "https://hala.test/api/product-content/previews.csv",
      undefined,
      testEnv
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: {
        code: "not_authenticated",
        message: "سجل دخولك للمتابعة.",
        requestId: response.headers.get("x-request-id")
      }
    });
  });

  it("returns a safe, complete error for an unknown route", async () => {
    const app = createApp();
    const response = await app.request("https://hala.test/missing", undefined, testEnv);
    const body: unknown = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: {
        code: "not_found",
        message: "المسار المطلوب غير موجود.",
        requestId: response.headers.get("x-request-id")
      }
    });
  });
});

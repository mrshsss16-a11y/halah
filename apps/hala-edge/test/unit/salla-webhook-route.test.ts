import { describe, expect, it } from "vitest";
import { createApp } from "../../src/http/app";

const encoder = new TextEncoder();
const secret = "synthetic-salla-webhook-secret";

async function signatureFor(rawBody: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, rawBody);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function testEnv(environment: "development" | "staging") {
  return {
    ENVIRONMENT: environment,
    APP_VERSION: "0.1.0-test",
    SALLA_WEBHOOK_SECRET: secret,
    DB: {} as D1Database
  };
}

describe("Salla webhook HTTP route", () => {
  it("fails closed outside development before checking a signature or touching D1", async () => {
    const response = await createApp().request(
      "https://hala.test/webhooks/salla",
      {
        method: "POST",
        headers: { "x-salla-security-strategy": "signature" },
        body: "{}"
      },
      testEnv("staging")
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "salla_webhook_not_configured" }
    });
  });

  it("rejects an invalid signature before it reads an event envelope or touches D1", async () => {
    const response = await createApp().request(
      "https://hala.test/webhooks/salla",
      {
        method: "POST",
        headers: {
          "x-salla-security-strategy": "signature",
          "x-salla-signature": "invalid"
        },
        body: '{"organization_id":"org-a","event_id":"event-a","event_type":"abandoned.cart"}'
      },
      testEnv("development")
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_webhook_signature" }
    });
  });

  it("parses the event only after a valid signature and rejects invalid JSON safely", async () => {
    const rawBody = encoder.encode("not-json");
    const response = await createApp().request(
      "https://hala.test/webhooks/salla",
      {
        method: "POST",
        headers: {
          "x-salla-security-strategy": "signature",
          "x-salla-signature": await signatureFor(rawBody)
        },
        body: rawBody
      },
      testEnv("development")
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_webhook_event" }
    });
  });
});

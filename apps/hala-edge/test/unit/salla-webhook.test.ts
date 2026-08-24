import { describe, expect, it } from "vitest";
import { verifySallaWebhookSignature } from "../../src/adapters/salla/webhook";

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

describe("Salla webhook signature contract", () => {
  it("accepts a signature strategy with a valid raw-body HMAC", async () => {
    const rawBody = encoder.encode('{"event":"abandoned.cart","id":"evt-test-1"}');
    const signature = await signatureFor(rawBody);

    await expect(
      verifySallaWebhookSignature({
        rawBody,
        headers: new Headers({
          "x-salla-security-strategy": "signature",
          "x-salla-signature": `sha256=${signature}`
        }),
        webhookSecret: secret
      })
    ).resolves.toEqual({ kind: "valid" });
  });

  it("rejects a modified raw body before JSON parsing can occur", async () => {
    const signedBody = encoder.encode('{"event":"abandoned.cart","id":"evt-test-1"}');
    const modifiedBody = encoder.encode('{"event":"abandoned.cart","id":"evt-test-2"}');
    const signature = await signatureFor(signedBody);

    await expect(
      verifySallaWebhookSignature({
        rawBody: modifiedBody,
        headers: new Headers({
          "x-salla-security-strategy": "signature",
          "x-salla-signature": signature
        }),
        webhookSecret: secret
      })
    ).resolves.toEqual({ kind: "invalid_signature" });
  });

  it("rejects missing and unsupported security strategies", async () => {
    const rawBody = encoder.encode("{}");

    await expect(
      verifySallaWebhookSignature({ rawBody, headers: new Headers(), webhookSecret: secret })
    ).resolves.toEqual({ kind: "missing_security_strategy" });

    await expect(
      verifySallaWebhookSignature({
        rawBody,
        headers: new Headers({ "x-salla-security-strategy": "none" }),
        webhookSecret: secret
      })
    ).resolves.toEqual({ kind: "unsupported_security_strategy", strategy: "none" });
  });
});

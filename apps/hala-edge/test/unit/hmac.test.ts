import { describe, expect, it } from "vitest";
import { verifyHmacSha256 } from "../../src/security/hmac";

const encoder = new TextEncoder();

async function createSignature(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("verifyHmacSha256", () => {
  it("accepts a matching signature for the exact raw body", async () => {
    const body = '{"event":"fixture"}';
    const secret = "local_test_secret";
    const signature = await createSignature(body, secret);

    await expect(
      verifyHmacSha256(encoder.encode(body), secret, `sha256=${signature}`)
    ).resolves.toEqual({ kind: "valid" });
  });

  it("rejects a missing or changed signature", async () => {
    const body = encoder.encode('{"event":"fixture"}');

    await expect(verifyHmacSha256(body, "local_test_secret", undefined)).resolves.toEqual({
      kind: "invalid_signature"
    });
    await expect(verifyHmacSha256(body, "local_test_secret", "00")).resolves.toEqual({
      kind: "invalid_signature"
    });
  });
});

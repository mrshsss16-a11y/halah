import { describe, expect, it } from "vitest";
import { hashSessionToken, issueSessionToken } from "../../src/security/session-token";

describe("session tokens", () => {
  it("issues a random raw token and stores only its deterministic hash", async () => {
    const issued = await issueSessionToken();

    expect(issued.rawToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(issued.tokenHash).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(issued.tokenHash).not.toBe(issued.rawToken);
    await expect(hashSessionToken(issued.rawToken)).resolves.toBe(issued.tokenHash);
  });

  it("does not reuse a token for a subsequent issue", async () => {
    const first = await issueSessionToken();
    const second = await issueSessionToken();

    expect(second.rawToken).not.toBe(first.rawToken);
    expect(second.tokenHash).not.toBe(first.tokenHash);
  });
});

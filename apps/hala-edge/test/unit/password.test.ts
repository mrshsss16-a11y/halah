import { describe, expect, it } from "vitest";
import { createPasswordDigest, verifyPassword } from "../../src/security/password";

describe("password digest", () => {
  it("verifies the original password but rejects a different password", async () => {
    const digest = await createPasswordDigest("TestOnlyPassword-2026");

    await expect(verifyPassword("TestOnlyPassword-2026", digest)).resolves.toBe(true);
    await expect(verifyPassword("WrongPassword-2026", digest)).resolves.toBe(false);
    expect(digest.algorithm).toBe("PBKDF2-SHA-256");
    expect(digest.iterations).toBeGreaterThanOrEqual(100_000);
    expect(digest.salt).not.toContain("TestOnlyPassword-2026");
    expect(digest.hash).not.toContain("TestOnlyPassword-2026");
  });

  it("rejects malformed and weak stored digest values", async () => {
    const digest = await createPasswordDigest("TestOnlyPassword-2026");

    await expect(
      verifyPassword("TestOnlyPassword-2026", { ...digest, hash: "not+base64url" })
    ).resolves.toBe(false);
    await expect(
      verifyPassword("TestOnlyPassword-2026", { ...digest, iterations: 99_999 })
    ).resolves.toBe(false);
  });
});

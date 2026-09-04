import { describe, expect, it } from "vitest";
import {
  issueCustomerMemoryIdentity,
  verifyCustomerMemoryIdentity
} from "../../src/security/customer-memory-identity";

const base = {
  profileId: "profile-a",
  organizationId: "org-a",
  storeConnectionId: "store-a",
  secret: "customer-memory-secret-that-is-at-least-32-bytes-long"
} as const;

describe("customer memory identity", () => {
  it("issues and verifies a scoped identity", async () => {
    const token = await issueCustomerMemoryIdentity({ ...base, now: 1_000, ttlSeconds: 300 });
    await expect(
      verifyCustomerMemoryIdentity({ ...base, token, now: 1_100 })
    ).resolves.toMatchObject({
      profileId: "profile-a",
      organizationId: "org-a",
      storeConnectionId: "store-a"
    });
  });

  it("rejects a token for another store", async () => {
    const token = await issueCustomerMemoryIdentity({ ...base, now: 1_000, ttlSeconds: 300 });
    await expect(
      verifyCustomerMemoryIdentity({ ...base, storeConnectionId: "store-b", token, now: 1_100 })
    ).resolves.toBeNull();
  });

  it("rejects tampering and expiration", async () => {
    const token = await issueCustomerMemoryIdentity({ ...base, now: 1_000, ttlSeconds: 300 });
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    await expect(
      verifyCustomerMemoryIdentity({ ...base, token: tampered, now: 1_100 })
    ).resolves.toBeNull();
    await expect(verifyCustomerMemoryIdentity({ ...base, token, now: 1_301 })).resolves.toBeNull();
  });
});

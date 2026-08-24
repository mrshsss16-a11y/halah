import { describe, expect, it } from "vitest";
import { KvAuthAttemptGuard } from "../../src/adapters/kv/auth-attempt-guard";

class FakeKvNamespace {
  public readonly entries = new Map<string, string>();
  public shouldFail = false;

  public async get(key: string): Promise<string | null> {
    if (this.shouldFail) {
      throw new Error("KV unavailable");
    }
    return this.entries.get(key) ?? null;
  }

  public async put(key: string, value: string): Promise<void> {
    if (this.shouldFail) {
      throw new Error("KV unavailable");
    }
    this.entries.set(key, value);
  }
}

function createGuard(namespace: FakeKvNamespace): KvAuthAttemptGuard {
  return new KvAuthAttemptGuard(namespace as unknown as KVNamespace);
}

const input = {
  operation: "login" as const,
  email: "owner@example.test",
  clientAddress: "198.51.100.18"
};

describe("KvAuthAttemptGuard", () => {
  it("allows five attempts then limits the next attempt within the same window", async () => {
    const namespace = new FakeKvNamespace();
    const guard = createGuard(namespace);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(guard.consume(input)).resolves.toEqual({ kind: "allowed" });
    }
    await expect(guard.consume(input)).resolves.toEqual({
      kind: "limited",
      retryAfterSeconds: 900
    });
  });

  it("does not persist the raw email or client address in its key", async () => {
    const namespace = new FakeKvNamespace();
    const guard = createGuard(namespace);

    await guard.consume(input);
    const storedKey = namespace.entries.keys().next().value;
    expect(typeof storedKey).toBe("string");
    if (typeof storedKey !== "string") {
      throw new Error("Expected an auth attempt key.");
    }
    expect(storedKey).not.toContain(input.email);
    expect(storedKey).not.toContain(input.clientAddress);
  });

  it("fails closed when KV is unavailable", async () => {
    const namespace = new FakeKvNamespace();
    namespace.shouldFail = true;

    await expect(createGuard(namespace).consume(input)).resolves.toEqual({ kind: "unavailable" });
  });
});

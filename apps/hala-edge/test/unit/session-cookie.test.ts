import { describe, expect, it } from "vitest";
import { buildExpiredSessionCookie, buildSessionCookie } from "../../src/http/session-cookie";

const expiry = "2026-09-01T00:00:00.000Z";

describe("session cookies", () => {
  it("uses HttpOnly and SameSite=Lax in every environment", () => {
    const cookie = buildSessionCookie("session-token", expiry, "development");

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("; Secure");
  });

  it("adds Secure to issue and expiry cookies in staging and production", () => {
    for (const environment of ["staging", "production"] as const) {
      const issued = buildSessionCookie("session-token", expiry, environment);
      const expired = buildExpiredSessionCookie(environment);

      expect(issued).toContain("; Secure");
      expect(expired).toContain("; Secure");
    }
  });
});

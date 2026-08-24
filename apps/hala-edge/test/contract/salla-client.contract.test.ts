import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SallaClient } from "../../src/adapters/salla/client";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("SallaClient contract", () => {
  it("parses an abandoned cart response from the isolated mock", async () => {
    server.use(
      http.get("https://salla.mock.test/admin/v2/carts/cart_fixture_001", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer fixture_token_only");
        return HttpResponse.json({
          id: "cart_fixture_001",
          status: "abandoned",
          checkoutUrl: "https://demo.example.test/checkout/cart_fixture_001"
        });
      })
    );

    const client = new SallaClient("https://salla.mock.test");
    const result = await client.getCart("cart_fixture_001", "fixture_token_only");

    expect(result).toEqual({
      kind: "ok",
      cart: {
        id: "cart_fixture_001",
        status: "abandoned",
        checkoutUrl: "https://demo.example.test/checkout/cart_fixture_001"
      }
    });
  });

  it("returns a typed result for a missing cart", async () => {
    server.use(
      http.get(
        "https://salla.mock.test/admin/v2/carts/missing_cart",
        () => new HttpResponse(null, { status: 404 })
      )
    );

    const client = new SallaClient("https://salla.mock.test");

    await expect(client.getCart("missing_cart", "fixture_token_only")).resolves.toEqual({
      kind: "not_found"
    });
  });

  it("rejects an upstream payload with missing fields", async () => {
    server.use(
      http.get("https://salla.mock.test/admin/v2/carts/malformed_cart", () =>
        HttpResponse.json({ id: "malformed_cart" })
      )
    );

    const client = new SallaClient("https://salla.mock.test");

    await expect(client.getCart("malformed_cart", "fixture_token_only")).resolves.toEqual({
      kind: "invalid_response"
    });
  });
});

import { z } from "zod";

const sallaCartSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    status: z.enum(["abandoned", "completed"]),
    checkoutUrl: z.string().url().max(2048)
  })
  .strict();

export type SallaCart = z.infer<typeof sallaCartSchema>;

export type SallaClientResult =
  | Readonly<{ kind: "ok"; cart: SallaCart }>
  | Readonly<{ kind: "not_found" }>
  | Readonly<{ kind: "upstream_error"; status: number }>
  | Readonly<{ kind: "invalid_response" }>;

export type FetchClient = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class SallaClient {
  private readonly baseUrl: URL;
  private readonly fetchClient: FetchClient;

  public constructor(baseUrl: string, fetchClient: FetchClient = fetch) {
    this.baseUrl = new URL(baseUrl);
    this.fetchClient = fetchClient;
  }

  public async getCart(cartId: string, accessToken: string): Promise<SallaClientResult> {
    const normalizedCartId = cartId.trim();
    const normalizedAccessToken = accessToken.trim();

    if (normalizedCartId.length === 0 || normalizedAccessToken.length === 0) {
      return { kind: "invalid_response" };
    }

    const requestUrl = new URL(
      `/admin/v2/carts/${encodeURIComponent(normalizedCartId)}`,
      this.baseUrl
    );
    const response = await this.fetchClient(requestUrl, {
      headers: {
        Authorization: `Bearer ${normalizedAccessToken}`,
        Accept: "application/json"
      }
    });

    if (response.status === 404) {
      return { kind: "not_found" };
    }

    if (!response.ok) {
      return { kind: "upstream_error", status: response.status };
    }

    const payload: unknown = await response.json().catch(() => null);
    const parsed = sallaCartSchema.safeParse(payload);

    if (!parsed.success) {
      return { kind: "invalid_response" };
    }

    return { kind: "ok", cart: parsed.data };
  }
}

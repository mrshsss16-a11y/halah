import { errorResponseSchema } from "@hala/contracts";
import type { Context } from "hono";
import type { HalaEnv } from "./types";

export function errorResponse(
  context: Context<HalaEnv>,
  status: 400 | 401 | 403 | 404 | 409 | 410 | 429 | 500 | 503,
  code: string,
  message: string
): Response {
  const body = errorResponseSchema.parse({
    error: {
      code,
      message,
      requestId: context.get("requestId")
    }
  });

  return context.json(body, status);
}

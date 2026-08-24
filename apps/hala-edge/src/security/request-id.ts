import { z } from "zod";

const requestIdSchema = z.string().uuid();

export function resolveRequestId(candidate: string | undefined): string {
  const parsed = requestIdSchema.safeParse(candidate);

  if (parsed.success) {
    return parsed.data;
  }

  return crypto.randomUUID();
}

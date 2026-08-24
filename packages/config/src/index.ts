import { environmentSchema, type Environment } from "@hala/contracts";
import { z } from "zod";

const runtimeConfigSchema = z
  .object({
    ENVIRONMENT: environmentSchema,
    APP_VERSION: z.string().trim().min(1).max(64)
  })
  .strict();

export type RuntimeConfig = Readonly<{
  environment: Environment;
  appVersion: string;
}>;

export function parseRuntimeConfig(input: unknown): RuntimeConfig {
  const parsed = runtimeConfigSchema.safeParse(input);

  if (!parsed.success) {
    throw new Error("Invalid runtime configuration: ENVIRONMENT and APP_VERSION are required.");
  }

  return Object.freeze({
    environment: parsed.data.ENVIRONMENT,
    appVersion: parsed.data.APP_VERSION
  });
}

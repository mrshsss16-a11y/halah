import type { RuntimeConfig } from "@hala/config";

export type HalaBindings = {
  DB: D1Database;
  AUTH_RATE_LIMIT: KVNamespace;
  SALLA_WEBHOOK_SECRET?: string;
  ENVIRONMENT: "development" | "staging" | "production";
  APP_VERSION: string;
};

export type HalaVariables = {
  requestId: string;
  config: RuntimeConfig;
};

export type HalaEnv = {
  Bindings: HalaBindings;
  Variables: HalaVariables;
};

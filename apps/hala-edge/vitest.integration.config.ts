import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    pool: "@cloudflare/vitest-pool-workers",
    poolOptions: {
      workers: {
        isolatedStorage: true,
        main: "./src/index.ts",
        wrangler: {
          configPath: "./wrangler.jsonc"
        }
      }
    }
  }
});

// Stages deployable static files into dist/ — the single source of what gets
// uploaded to Cloudflare Pages. Anything not listed here never ships (docs,
// persona reference, editor tooling, this script itself).
import { cpSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

const INCLUDE = /\.(html|css|js|png|svg|webp|ico|txt)$/;
const EXCLUDE_DIRS = new Set([".git", ".agents", ".wrangler", "node_modules", "dist", "docs", "functions", "migrations", "persona", "scripts"]);

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

let count = 0;
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    if (!EXCLUDE_DIRS.has(entry.name)) {
      console.warn(`skipped unlisted directory: ${entry.name} (add to stage.mjs if it should ship)`);
    }
    continue;
  }
  if (INCLUDE.test(entry.name)) {
    cpSync(join(root, entry.name), join(dist, entry.name));
    count++;
  }
}
console.log(`staged ${count} files into dist/`);

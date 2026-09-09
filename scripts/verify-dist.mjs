// Pre-deploy guard: refuse to ship a dist/ that would disable the API.
//
// Cloudflare Pages switches to "Advanced Mode" when the output directory
// contains _worker.js — and in that mode it ignores the functions/ directory
// completely. That took all 56 /api/* endpoints down with 404s on production
// once already (2026-07-31), including the WhatsApp webhook and login.
//
// This runs as part of `npm run deploy` so the mistake cannot reach production
// again. See AGENT.md section 4.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
const FORBIDDEN = ["_worker.js", "_routes.json"];

if (!existsSync(DIST)) {
  console.error(`✖ ${DIST}/ does not exist — run the build first.`);
  process.exit(1);
}

const present = FORBIDDEN.filter((f) => existsSync(join(DIST, f)));

if (present.length > 0) {
  console.error(`
✖ DEPLOY BLOCKED — ${DIST}/ contains: ${present.join(", ")}

These files put Cloudflare Pages into Advanced Mode, which makes it ignore the
functions/ directory entirely. Deploying this would return 404 for every
/api/* endpoint, including the WhatsApp webhook and login.

This is what "astro build" produces. Until every endpoint is migrated into
src/pages/api/, the deployable build is stage.mjs only:

    node scripts/stage.mjs
    npx wrangler pages deploy dist --project-name hala-ai-os --branch=main

See AGENT.md section 4.
`);
  process.exit(1);
}

// A `_redirects` rewrite to a .html target loops forever against Pages' own
// clean-URL handling (Pages serves /x from x.html and 308s /x.html back to /x).
// Happened on 2026-09-09: /dashboard (the Salla iframe) 308'd to itself until
// the file was removed. Pages already provides clean URLs — never rewrite to .html.
const redirectsPath = join(DIST, "_redirects");
if (existsSync(redirectsPath)) {
  const bad = readFileSync(redirectsPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => /^\/\S*\s+\/\S+\.html\s+200\b/.test(line.trim()));
  if (bad.length > 0) {
    console.error(`✖ DEPLOY BLOCKED — ${DIST}/_redirects rewrites to .html (308 loop with clean URLs):`);
    for (const line of bad) console.error(`    ${line}`);
    console.error("See AGENT.md section 4.");
    process.exit(1);
  }
}

const files = readdirSync(DIST);
if (!files.some((f) => f.endsWith(".html"))) {
  console.error(`✖ DEPLOY BLOCKED — no .html files in ${DIST}/. The build produced nothing to serve.`);
  process.exit(1);
}

console.log(`✔ dist/ is safe to deploy (${files.length} entries, functions/ will be used).`);

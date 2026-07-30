// Stages deployable static files into dist/ — the single source of what gets
// uploaded to Cloudflare Pages. Anything not listed here never ships (docs,
// persona reference, editor tooling, this script itself).
//
// HTML files go through a minimal server-side-include pass first: shared
// fragments (nav shells, FOUC bootstrap, banners) live once in partials/
// and get inlined into each page at build time. Output stays flat static
// HTML — no client-side fetch, no framework, no runtime cost — this only
// removes copy-pasted markup at the source.
import { cpSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const partialsDir = join(root, "partials");
const stylesDir = join(root, "styles");

const INCLUDE = /\.(html|css|js|png|svg|webp|ico|txt)$/;
// Cloudflare Pages config files — no extension, matched by exact name instead.
const EXACT_NAME_INCLUDE = new Set(["_headers", "_redirects"]);
const EXCLUDE_DIRS = new Set([".git", ".agents", ".wrangler", "node_modules", "dist", "docs", "functions", "migrations", "partials", "persona", "scripts", "styles"]);
const INCLUDE_TAG = /<!--\s*#include\s+([\w./-]+)\s*-->/g;

function resolveIncludes(html, fromFile, depth = 0) {
  if (depth > 5) throw new Error(`include nesting too deep in ${fromFile} — possible cycle`);
  return html.replace(INCLUDE_TAG, (whole, relPath) => {
    const partialPath = join(root, relPath);
    let partial;
    try {
      partial = readFileSync(partialPath, "utf8");
    } catch {
      throw new Error(`${fromFile}: #include "${relPath}" not found at ${partialPath}`);
    }
    return resolveIncludes(partial, relPath, depth + 1);
  });
}

mkdirSync(dist, { recursive: true });

// style.css is authored as numbered sections under styles/ (01-base,
// 02-motion-components, ...) — concatenated in filename order into one
// dist/style.css so pages keep a single stylesheet request. Splitting the
// source only; the shipped output is unchanged.
const styleParts = readdirSync(stylesDir).filter((f) => f.endsWith(".css")).sort();
const styleCss = styleParts.map((f) => readFileSync(join(stylesDir, f), "utf8")).join("");
writeFileSync(join(dist, "style.css"), styleCss);

let count = 1;
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    if (!EXCLUDE_DIRS.has(entry.name)) {
      console.warn(`skipped unlisted directory: ${entry.name} (add to stage.mjs if it should ship)`);
    }
    continue;
  }
  if (!INCLUDE.test(entry.name) && !EXACT_NAME_INCLUDE.has(entry.name)) continue;

  const srcPath = join(root, entry.name);
  const outPath = join(dist, entry.name);
  if (entry.name.endsWith(".html")) {
    const html = resolveIncludes(readFileSync(srcPath, "utf8"), entry.name);
    writeFileSync(outPath, html);
  } else {
    cpSync(srcPath, outPath);
  }
  count++;
}
console.log(`staged ${count} files into dist/ (includes resolved from partials/)`);

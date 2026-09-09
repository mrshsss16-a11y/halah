#!/usr/bin/env node
/**
 * حراس الواجهة (المرحلة ٢ من docs/ARCHITECTURE.md §٣ — الصف الثاني "الواجهة").
 * نفس نمط scripts/audit-security.mjs: ملف واحد بأربعة فحوص، مربوط بـ`npm test`.
 * خروج غير صفري = ارتداد → يفشل npm test.
 *
 *  (أ) audit-dup-fn      : دالة JS بنفس الاسم معرّفة بأكثر من صفحة/ملف بمحتوى مختلف
 *  (ب) audit-dead-links  : href داخلي يشير لمسار غير موجود (يعتبر _redirects ضمن الفحص)
 *  (ج) audit-undef-css   : صنف CSS مخصص مستخدم بـclass="" وغير معرّف بـstyles/** ولا
 *                          بـ<style> الداخلي لنفس الصفحة (يستثني Tailwind utilities)
 *  (د) audit-page-size   : صفحة HTML بالجذر تجاوزت ٨٠٠ سطر إلا قائمة سماح مؤرَّخة
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const failures = [];
const fail = (guard, file, detail) => failures.push(`${guard} ${file}: ${detail}`);
const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");

function walk(dir, ext, out = [], excludeDirs = new Set(["node_modules", "dist", ".git", "archive"])) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (excludeDirs.has(name)) continue;
      walk(p, ext, out, excludeDirs);
    } else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

const rootHtmlFiles = readdirSync(ROOT).filter((n) => n.endsWith(".html")).map((n) => join(ROOT, n));
const partialFiles = existsSync(join(ROOT, "partials")) ? walk(join(ROOT, "partials"), ".html") : [];
const jsFiles = [
  ...(existsSync(join(ROOT, "public")) ? walk(join(ROOT, "public"), ".js") : []),
  join(ROOT, "widget.js"),
  join(ROOT, "theme.js")
].filter((f) => existsSync(f));

// ── (أ) دوال JS مكررة بمحتوى مختلف ──────────────────────────────────────────
// نجمع كل تعريف دالة top-level (function name(...) أو const/let/var name = function|=>)
// من كل ملف *.html بالجذر (ضمن <script> غير src) وكل ملف JS مملوك بالواجهة، ونقارن
// المحتوى الحرفي بين الملفات المختلفة لنفس الاسم.
// المرحلة ٥: منطق الصفحتين صار وحدات ES بـpublic/js/{dashboard,admin}/**،
// وتعريفاتها `export function` و`export async function` — بلا هذه البادئات
// الاختيارية كان الفحص يعمى عن كل دالة انتقلت من <script> المضمّن.
const FN_DEF_RE = /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;

function extractInlineScripts(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out.join("\n");
}

function extractFunctionBody(src, startIdx) {
  // startIdx points at the "{" — do a simple brace-matcher to grab the body.
  let depth = 0, i = startIdx;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(startIdx, i + 1);
    }
  }
  return src.slice(startIdx, startIdx + 200);
}

const fnDefs = new Map(); // name -> [{file, body}]
const sources = [
  ...rootHtmlFiles.map((f) => ({ file: f, src: extractInlineScripts(readFileSync(f, "utf8")) })),
  ...jsFiles.map((f) => ({ file: f, src: readFileSync(f, "utf8") }))
];

for (const { file, src } of sources) {
  let m;
  const re = new RegExp(FN_DEF_RE);
  while ((m = re.exec(src))) {
    const name = m[1];
    const braceIdx = src.indexOf("{", m.index + m[0].length - 1);
    const body = extractFunctionBody(src, braceIdx).replace(/\s+/g, " ").trim();
    if (!fnDefs.has(name)) fnDefs.set(name, []);
    fnDefs.get(name).push({ file: rel(file), body });
  }
}

for (const [name, defs] of fnDefs) {
  if (defs.length < 2) continue;
  const bodies = new Set(defs.map((d) => d.body));
  if (bodies.size > 1) {
    fail("أ", defs.map((d) => d.file).join(", "), `دالة "${name}" معرّفة بأكثر من ملف بمحتوى مختلف`);
  }
}

// ── (ب) روابط داخلية معطّلة ─────────────────────────────────────────────────
const redirectsFile = join(ROOT, "_redirects");
const redirectPaths = new Set();
if (existsSync(redirectsFile)) {
  for (const line of readFileSync(redirectsFile, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [from] = t.split(/\s+/);
    if (from) redirectPaths.add(from);
  }
}

function pathExists(hrefPath) {
  let p = hrefPath.split("#")[0].split("?")[0];
  if (!p || p === "/") return true;
  if (redirectPaths.has(p)) return true;
  if (p.startsWith("/api/")) return true; // functions/ خارج ملكية هذا السكربت — لا يُفحص
  const clean = p.replace(/^\//, "");
  return existsSync(join(ROOT, clean)) || existsSync(join(ROOT, clean + ".html"));
}

const HREF_RE = /href="([^"]+)"/g;
for (const f of rootHtmlFiles) {
  const html = readFileSync(f, "utf8");
  let m;
  const re = new RegExp(HREF_RE);
  while ((m = re.exec(html))) {
    const href = m[1];
    if (!href.startsWith("/") && !/^[a-z-]+\.html/i.test(href)) continue; // external/anchor-only
    if (!pathExists(href)) fail("ب", rel(f), `href="${href}" لا يشير لمسار موجود`);
  }
}

// ── (ج) أصناف CSS مخصصة غير معرّفة ──────────────────────────────────────────
const stylesDir = join(ROOT, "styles");
const sharedCss = existsSync(stylesDir)
  ? readdirSync(stylesDir).filter((f) => f.endsWith(".css")).map((f) => readFileSync(join(stylesDir, f), "utf8")).join("\n")
  : "";
const definedInShared = new Set([...sharedCss.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));

// نطاقات Tailwind الشائعة نستثنيها بregex بدل قائمة كاملة — أي صنف يطابقها ليس "مخصصاً".
// نقشّر بادئات المتغيّرات (sm:, hover:, dark:, group-hover:, ...) أولاً ثم نطابق الجذر.
const VARIANT_PREFIX_RE = /^([\w-]+:)+/;
const UTILITY_ROOT_RE = new RegExp(
  "^(?:" +
  [
    "bg", "text", "border", "rounded", "p[xytrbl]?", "m[xytrbl]?", "gap", "flex", "grid",
    "items", "justify", "self", "place", "content", "w", "h", "max-w", "max-h", "min-w", "min-h",
    "space", "top", "left", "right", "bottom", "inset", "z", "font", "leading", "tracking",
    "shadow", "opacity", "transition", "duration", "ease", "delay", "cursor", "overflow",
    "whitespace", "select", "aspect", "object", "backdrop", "outline", "ring", "translate",
    "scale", "rotate", "skew", "animate", "col", "row", "divide", "from", "via", "to",
    "decoration", "pointer-events", "wght", "resize", "appearance", "list", "table", "align",
    "float", "clear", "order", "basis", "grow", "shrink", "will-change", "filter", "blur",
    "brightness", "contrast", "grayscale", "saturate", "sepia", "drop-shadow", "backface",
    "columns", "break", "box", "caret", "accent", "touch", "snap", "scroll", "stroke", "fill",
    "indent", "underline-offset", "line-clamp", "isolation", "mix-blend", "bg-blend", "origin"
  ].join("|") + ")(-|$)"
);
const BARE_UTILITY = new Set([
  "flex", "grid", "hidden", "block", "inline", "inline-block", "inline-flex", "inline-grid",
  "relative", "absolute", "fixed", "sticky", "static", "border", "rounded", "shadow",
  "container", "antialiased", "underline", "italic", "truncate", "capitalize", "uppercase",
  "lowercase", "transition", "group", "peer", "isolate", "contents", "table", "hidden",
  "visible", "invisible", "collapse", "sr-only", "not-sr-only", "prose"
]);
function isTailwindLike(clsRaw) {
  let cls = clsRaw.replace(VARIANT_PREFIX_RE, "");
  if (cls.startsWith("-")) cls = cls.slice(1); // negative utilities: -translate-x-1/2, -mt-4
  if (!cls) return true;
  if (BARE_UTILITY.has(cls)) return true;
  if (UTILITY_ROOT_RE.test(cls)) return true;
  if (/^\[.*\]$/.test(cls)) return true; // bare arbitrary value class
  if (/^\d/.test(cls)) return true;
  if (cls.length <= 2) return true;
  return false;
}

// كلاسات تُستخدم فقط كخطّاف JS (querySelectorAll('.name'), classList.toggle/add/remove
// بالنص المطابق) بلا أي تنسيق بصري مقصود منها — نمط شائع ومقصود بهذا المشروع
// (dashboard.html: .review-tab/.fb-star، agent-studio.html: .tab/.panel). لا تُعتبر
// "غير معرّفة": الفحص عن أصناف تحتاج تنسيقاً غائباً، لا عن أصناف علّامة فقط.
// المرحلة ٥: العلامة صارت بـpartials/** والـquerySelectorAll الذي يستعملها صار
// بـpublic/js/** — البحث داخل نفس الملف فقط كان سيفشل على .review-tab/.fb-star
// بعد التقسيم. النطاق الآن كل JS الواجهة + الصفحة نفسها.
const jsCorpus = jsFiles.map((f) => readFileSync(f, "utf8")).join("\n");
function isJsHookClass(cls, html) {
  const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("querySelector(?:All)?\\(\\s*[`'\"]\\." + escaped + "(['\"\\s.[]|`)", "");
  return re.test(html) || re.test(jsCorpus);
}

// المرحلة ٥: <style> الصفحة يعيش الآن بـpartials/*-head.html بينما العلامة التي
// يُنسّقها موزّعة على partials أخرى تُدمَج معه بنفس الصفحة وقت البناء. الفحص
// «هل لهذا الصنف تنسيق؟» يجب أن يرى كل <style> بالواجهة، لا <style> ملف واحد.
const CLASS_RE = /class="([^"]+)"/g;
const STYLE_RE = /<style[^>]*>([\s\S]*?)<\/style>/g;
const allInlineStyles = [...rootHtmlFiles, ...partialFiles]
  .map((f) => [...readFileSync(f, "utf8").matchAll(STYLE_RE)].map((m) => m[1]).join("\n"))
  .join("\n");
const definedInline = new Set([...allInlineStyles.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
for (const f of [...rootHtmlFiles, ...partialFiles]) {
  const html = readFileSync(f, "utf8");
  let m;
  const re = new RegExp(CLASS_RE);
  while ((m = re.exec(html))) {
    const raw = m[1];
    // نتجاهل مطابقات class="..." داخل قوالب JS الحرفية (template literals) — ليست
    // خصائص HTML فعلية، بل نصاً برمجياً يحوي ${...} أو اقتباسات JS.
    if (/[${}'`]/.test(raw)) continue;
    for (const cls of raw.split(/\s+/)) {
      if (!cls || isTailwindLike(cls)) continue;
      if (definedInShared.has(cls) || definedInline.has(cls)) continue;
      if (isJsHookClass(cls, html)) continue;
      fail("ج", rel(f), `class="${cls}" غير معرّف بـstyles/** ولا بـ<style> الداخلي ولا مستخدم كخطّاف JS`);
    }
  }
}

// ── (د) حجم صفحات الجذر ──────────────────────────────────────────────────
// قائمة سماح مؤرَّخة (المرحلة ٢، ٢٠٢٦-٠٩-٠٩) — عدد الأسطر الفعلي وقت الكتابة.
// يفشل الفحص لو زاد العدد الحالي عن المكتوب هنا (لا يفشل لو قلّ).
// أُفرغت بالمرحلة ٥ — النصف أ (2026-09-09): dashboard.html ١٩٤٢→٤٣ سطراً
// وadmin.html ٩١٥→٤٢ بعد نقل العلامة إلى partials/ والـJS إلى public/js/**.
// كلتاهما تحت الحد ٨٠٠ بلا استثناء.
const SIZE_ALLOWLIST = {};
const MAX_LINES = 800;
function countLines(text) {
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop(); // تجاهل السطر الفارغ الأخير من \n نهاية الملف
  return lines.length;
}
for (const f of rootHtmlFiles) {
  const name = rel(f);
  const lineCount = countLines(readFileSync(f, "utf8"));
  const allowed = SIZE_ALLOWLIST[name];
  if (allowed != null) {
    if (lineCount > allowed) fail("د", name, `تجاوز قائمة السماح المؤرَّخة (${lineCount} > ${allowed} سطراً)`);
    continue;
  }
  if (lineCount > MAX_LINES) fail("د", name, `${lineCount} سطراً > الحد ${MAX_LINES} وغير موجودة بقائمة السماح`);
}

if (failures.length) {
  console.error("✖ تدقيق الواجهة: ارتداد مكتشف —");
  for (const x of failures) console.error("  " + x);
  process.exit(1);
}
console.log("✔ تدقيق الواجهة: أ ب ج د سليمة.");

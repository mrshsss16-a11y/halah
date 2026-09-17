// حارس ارتداد: كل `.put(` على HALA_CACHE بأي ملف تحت functions/** لازم يحمل
// `expirationTtl` (WP-A8، 2026-09-17).
//
// لماذا: KV بلا سقف انتهاء = تراكم دائم لا يُنظَّف — كل مفتاح جديد بلا TTL دَين
// تخزين لا يُسدَّد أبداً، ويتضخّم بصمت (نفس فلسفة audit-file-size لكن للتخزين
// لا للكود). قبل هذا الالتزام كانت accessState.js وfaqSync.js تكتبان بلا
// expirationTtl إطلاقاً — أُصلح ذلك بنفس الدفعة (انظر core/accessState.js
// وdomain/faqSync.js). الاستثناء الوحيد: تعليق `// kv-no-ttl-ok: <سبب>` بنفس
// السطر أو السطر السابق — لمفتاح يحتاج بقاءً دائماً بقرار صريح موثَّق، لا سهواً.
//
// الفحص نصي (لا يشغّل الكود): يمسك نمط الاستدعاء `HALA_CACHE.put(...)` ويتحقق
// أن القوس المقابل يحتوي `expirationTtl` قبل أن يُغلَق، بموازنة أقواس بسيطة —
// كافٍ لكل الاستخدامات الحالية (لا `.put(` متداخل داخل وسائط `.put` نفسها بهذا
// المستودع)، ويفضّل إنذاراً كاذباً نادراً على تسريب صامت.
//
// لا readFileSync لاختبار سلوك وحدة (القاعدة ٦ بـWP-RULES) — هذا اختبار شكل
// الكود (نمط نصي)، تماماً كـح٧/ح٨/ح٩ ببقية audit-security.mjs وكـم١/م٢
// بـaudit-migrations.mjs، فقراءة السورس هنا هي الفحص نفسه لا التفافاً حوله.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { createRunner } from "../_helpers.mjs";

const ROOT = process.cwd();
const FN_DIR = join(ROOT, "functions");

const { assert, done } = createRunner("kv-ttl");

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (["node_modules", "dist", "archive", ".git", ".wrangler"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}
const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");

/** يوازن الأقواس بدءاً من الحرف بعد `(` المفتوح؛ يُرجع فهرس `)` المقابل أو -1. */
function closeParen(s, from) {
  let depth = 1;
  for (let i = from; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/**
 * @returns {{file:string, index:number}[]} كل نداء `HALA_CACHE.put(` بلا
 *   expirationTtl داخل قوسه ولا تعليق `kv-no-ttl-ok:` بنفس السطر/السطر السابق.
 */
function findMissingTtl(src, file) {
  const missing = [];
  const re = /HALA_CACHE\.put\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const argsStart = m.index + m[0].length;
    const end = closeParen(src, argsStart);
    const args = end > 0 ? src.slice(argsStart, end) : src.slice(argsStart, argsStart + 400);
    if (/expirationTtl/.test(args)) continue;

    const before = src.slice(0, m.index);
    const lineStart = before.lastIndexOf("\n") + 1;
    const prevLineStart = before.lastIndexOf("\n", lineStart - 2) + 1;
    const currentAndPrevLine = src.slice(prevLineStart, src.indexOf("\n", m.index) === -1 ? src.length : src.indexOf("\n", m.index));
    if (/kv-no-ttl-ok:\s*\S/.test(currentAndPrevLine)) continue;

    missing.push({ file, index: m.index });
  }
  return missing;
}

try {
  // ── (أ) الشجرة الحقيقية: صفر مخالفة اليوم ────────────────────────────────
  const realFailures = [];
  for (const f of walk(FN_DIR)) {
    const src = readFileSync(f, "utf8");
    if (!src.includes("HALA_CACHE.put")) continue;
    for (const hit of findMissingTtl(src, rel(f))) {
      realFailures.push(`${hit.file}: HALA_CACHE.put بلا expirationTtl ولا تعليق kv-no-ttl-ok`);
    }
  }
  assert(realFailures.length === 0, `كل استدعاءات HALA_CACHE.put بـfunctions/** تحمل expirationTtl اليوم (${realFailures.join(" | ") || "لا مخالفات"})`);

  // ── (ب) الفحص يمسك مخالفة مصطنعة (بلا TTL، بلا تعليق إعفاء) ──────────────
  {
    const bad = `export async function f(env) {\n  await env.HALA_CACHE.put("k", "v");\n}\n`;
    const found = findMissingTtl(bad, "fixture.js");
    assert(found.length === 1, "الفحص يمسك .put بلا expirationTtl وبلا تعليق إعفاء");
  }

  // ── (ج) .put بـexpirationTtl لا يُعتبر مخالفة ────────────────────────────
  {
    const good = `export async function f(env) {\n  await env.HALA_CACHE.put("k", "v", { expirationTtl: 60 });\n}\n`;
    assert(findMissingTtl(good, "fixture.js").length === 0, ".put بـexpirationTtl صريح لا يُبلَّغ كمخالفة");
  }

  // ── (د) تعليق kv-no-ttl-ok بالسطر السابق يُعفي المفتاح صراحة ─────────────
  {
    const exempt = `export async function f(env) {\n  // kv-no-ttl-ok: مفتاح دائم بقرار مالك موثَّق بـP99\n  await env.HALA_CACHE.put("permanent_flag", "v");\n}\n`;
    assert(findMissingTtl(exempt, "fixture.js").length === 0, "تعليق kv-no-ttl-ok بالسطر السابق يُعفي .put من الفحص");
  }
} finally {
  // لا شجرة وهمية على القرص بهذا الاختبار — فحص (أ) على الشجرة الحقيقية و(ب-د) بسلاسل نصية داخل الذاكرة فقط.
}

done();

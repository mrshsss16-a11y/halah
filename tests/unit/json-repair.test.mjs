// فاصلة زائدة قبل «}» (جولة الجاهزية 2026-09-13): مخرج GPT 5.6 Luna الخام لحقيبة فشل تحليله بالتشغيلتين.
import { readFileSync } from "node:fs";
import { createRunner } from "../_helpers.mjs";
import { stripTrailingCommas } from "../../functions/_lib/ai/parseModelJson.js";
import { parseSeoResponse } from "../../functions/_lib/domain/copyParse.js";

const { assert, done } = createRunner("json-repair");

async function main() {
  const raw = readFileSync(new URL("../fixtures/raw/trailing-comma-bag.txt", import.meta.url), "utf8");
  let direct = null;
  try { direct = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { direct = null; }
  assert(direct === null, "JR-0: المخرج الخام الحقيقي يفشل مع JSON.parse مباشرة (يثبت أن الحالة حقيقية)");
  const parsed = parseSeoResponse(raw, "حقيبة يد كلاسيكية جلد صناعي", null);
  assert(parsed.copywriting.description.length > 50 && Array.isArray(parsed.faqs), "JR-1: الصفحة تُحلَّل بعد حذف الفاصلة الزائدة — لا COPY_PARSE_FAILED");
  assert(stripTrailingCommas('{"a": "x, }", "b": [1, 2,], }') === '{"a": "x, }", "b": [1, 2] }', "JR-2: الفاصلة داخل النص تبقى، والزائدة قبل ] و} تُحذف");
  assert(stripTrailingCommas('{"a": "قال \\"مرحبا,\\" }", }') === '{"a": "قال \\"مرحبا,\\" }" }', "JR-3: علامة مهرَّبة داخل النص لا تُنهي السلسلة");
  let threw = false;
  try { parseSeoResponse('{"seo": {"title": "x"}, "copywriting": {"description": "وصف", }', "x", null); } catch { threw = true; }
  assert(threw, "JR-4: JSON ناقص (قوس غير مغلق) يبقى فشلاً صريحاً — الإصلاح لا يكمل ما نقص");
}

main().then(done);

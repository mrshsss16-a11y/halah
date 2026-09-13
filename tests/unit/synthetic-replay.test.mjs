// حالات صناعية بأنماط أخطاء نماذجنا (2026-09-13): وكلاء يقلّدون ما رصدناه بالأرشيف وذاكرة الدروس — مدح بصيغ
// جديدة، ادعاءات بلهجة، أخطاء تأنيث، تسريب ملاحظات الصورة، أخطاء حقول السيو — ويحاولون الإفلات من الحراس.
// كل حالة تحدد ما يجب أن يُحذف (mustRemove) وما يجب أن يبقى (mustKeep) كي لا يُكافأ الحذف الزائد.
// صفر نداء نموذج. الملفات: tests/fixtures/synthetic/*.json
// { id, family, category, name, sourceText, notes, page, mustRemove: [..], mustKeep: [..] }
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRunner } from "../_helpers.mjs";
import { polishPage, pageText } from "../../functions/_lib/domain/copyPage.js";
import { cleanDescription, cleanPublishedFields } from "../../functions/_lib/domain/copyParse.js";

const { assert, done } = createRunner("synthetic-replay");
const DIR = new URL("../fixtures/synthetic/", import.meta.url);
const CATEGORY_AR = { jewelry: "مجوهرات", watches: "ساعات", abayas: "عبايات", dresses: "فساتين", perfumes: "عطور", bags: "حقائب", shoes: "أحذية", menswear: "أزياء رجالية", skirts: "تنانير", blouses: "بلايز" };
const norm = (t) => String(t || "").replace(/[ً-ْـ]/g, "").replace(/\s+/g, " ").trim();

function runPipeline(c) {
  const p = JSON.parse(JSON.stringify(c.page || {}));
  const opts = { sourceText: c.sourceText || c.name, productName: c.name };
  const cw = p.copywriting || (p.copywriting = {});
  cw.description = cleanDescription(cw.description || "", opts);
  cw.excerpt = cleanDescription(cw.excerpt || "", opts).slice(0, 250);
  cw.whatsapp = cleanDescription(cw.whatsapp || "", opts);
  cleanPublishedFields(p, { sourceText: c.sourceText || c.name, name: c.name });
  polishPage(p, { name: c.name, sourceText: c.sourceText || c.name, notes: c.notes || "", category: CATEGORY_AR[c.category] || c.category || "" });
  return p;
}

async function main() {
  const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".json")) : [];
  const cases = files.flatMap((f) => {
    const data = JSON.parse(readFileSync(new URL(f, DIR), "utf8"));
    return Array.isArray(data) ? data : [data];
  });
  assert(true, `SR-0: ${cases.length} حالة صناعية`);
  const missedRemove = [];
  const overDeleted = [];
  for (const c of cases) {
    const text = norm(pageText(runPipeline(c)));
    for (const phrase of c.mustRemove || []) if (text.includes(norm(phrase))) missedRemove.push(`${c.id} [${c.family}]: «${phrase}»`);
    for (const phrase of c.mustKeep || []) if (!text.includes(norm(phrase))) overDeleted.push(`${c.id} [${c.family}]: «${phrase}»`);
  }
  assert(missedRemove.length === 0, `SR-1: كل خطأ صناعي يُحذف (${missedRemove.length} أفلت)${missedRemove.length ? ` — ${missedRemove.slice(0, 6).join(" | ")}` : ""}`);
  assert(overDeleted.length === 0, `SR-2: لا حذف زائد لحقائق صحيحة (${overDeleted.length})${overDeleted.length ? ` — ${overDeleted.slice(0, 6).join(" | ")}` : ""}`);
}

main().then(done);

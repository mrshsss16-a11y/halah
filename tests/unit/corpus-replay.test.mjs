// أرشيف التوليدات الحقيقية (2026-09-13): كل صفحة كتبتها نماذجنا فعلاً — جولات محلية بثماني فئات وسجل الإنتاج —
// تُمرَّر على سلسلة ما بعد التوليد نفسها (cleanDescription → cleanPublishedFields → polishPage) وتُفحص حقلاً
// حقلاً. صفر نداء نموذج: كل إصلاح يُجرَّب على أخطاء نماذجنا الحقيقية قبل النشر، وأي ارتداد يُكسر هنا.
// تُضاف حالة جديدة بملف JSON في tests/fixtures/corpus/ (id, name, sourceText, notes, category, page, rawLines?).
import { readFileSync, readdirSync } from "node:fs";
import { createRunner } from "../_helpers.mjs";
import { polishPage } from "../../functions/_lib/domain/copyPage.js";
import { cleanDescription, cleanPublishedFields } from "../../functions/_lib/domain/copyParse.js";
import { unsourcedClaims, fixSizeChartClosing } from "../../functions/_lib/domain/copyClaims.js";
import { findColorAgreement, splitSentencesKeep, joinSentences } from "../../functions/_lib/domain/copyPhrases.js";
import { stripJudgments, unsourcedJudgment } from "../../functions/_lib/domain/copyJudgments.js";
import { dropUnsourcedOccasions } from "../../functions/_lib/domain/copyOccasion.js";
import { ATTACHED, otherItem } from "../../functions/_lib/domain/copyNotes.js";

const { assert, done } = createRunner("corpus-replay");
const DIR = new URL("../fixtures/corpus/", import.meta.url);
const CATEGORY_AR = { jewelry: "مجوهرات", watches: "ساعات", abayas: "عبايات", dresses: "فساتين", perfumes: "عطور", bags: "حقائب", shoes: "أحذية", menswear: "أزياء رجالية" };
const norm = (t) => String(t || "").replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase();
const words = (t) => String(t || "").split(/\s+/).filter(Boolean).length;

function runPipeline(c) {
  const p = JSON.parse(JSON.stringify(c.page));
  const opts = { sourceText: c.sourceText, productName: c.name };
  const cw = p.copywriting || (p.copywriting = {});
  cw.description = cleanDescription(cw.description || "", opts);
  cw.excerpt = cleanDescription(cw.excerpt || "", opts).slice(0, 250);
  cw.whatsapp = cleanDescription(cw.whatsapp || "", opts);
  cleanPublishedFields(p, { sourceText: c.sourceText, name: c.name });
  polishPage(p, { name: c.name, sourceText: c.sourceText, notes: c.notes, category: CATEGORY_AR[c.category] || c.category });
  return p;
}

function fieldsOf(p, c) {
  const cw = p.copywriting || {};
  const seo = p.seo || {};
  const out = [["description", cw.description], ["excerpt", cw.excerpt], ["whatsapp", cw.whatsapp], ["seo.title", seo.title], ["seo.seoTitle", seo.seoTitle], ["seo.meta", seo.metaDescription], ["imageAlt", p.imageAlt]];
  (cw.highlights || []).forEach((h, i) => out.push([`highlight${i}`, h]));
  (p.faqs || []).forEach((f, i) => { out.push([`faq${i}.q`, f.q]); out.push([`faq${i}.a`, f.a]); });
  (p.specsTable || []).forEach((r, i) => out.push([`spec${i}`, `${r.key}: ${r.value}`]));
  (p.tags || []).forEach((t, i) => out.push([`tag${i}`, t]));
  (c.rawLines || []).forEach((line, k) => {
    const one = { copywriting: { description: "", excerpt: cleanDescription(line, { sourceText: c.sourceText, productName: c.name }), whatsapp: "", highlights: [] }, seo: {}, faqs: [], specsTable: [], tags: [] };
    polishPage(one, { name: c.name, sourceText: c.sourceText, notes: c.notes });
    out.push([`raw${k}`, one.copywriting.excerpt]);
  });
  return out.filter(([, t]) => typeof t === "string" && t.trim());
}

const JUDGMENT = /(?<!\p{L})(?:و|ب|ل)?(?:ال)?((?:[أا]نيق|فاخر|فخم|مريح|مثالي|جذاب|رائع|مميز|عصري|فريد|راق|ساحر|خلاب|[أا]ناق|فخام|جمالي)\p{L}*)/u;
const CHECKS = {
  judgment: (t, c) => { const m = t.match(JUDGMENT); return m && !norm(c.sourceText).includes(norm(m[1]).slice(0, 4)) ? m[0] : null; },
  claim: (t, c) => unsourcedClaims(t, c.sourceText).join("+") || null,
  color_agreement: (t) => findColorAgreement(t).map((a) => a.wrong).join("، ") || null,
  al_ghair: (t) => (t.match(/(?<!\p{L})(?:و)?الغير[ \t]+\p{L}+/u) || [])[0] || null,
  dangling_noun: (t) => (t.match(/(?<!\p{L})(?:و|ب)(?:تصميم|طابع|لمسة|مظهر|إطلالة|اطلالة)(?=[ \t]*[،.])/u) || [])[0] || null,
  latin_word: (t, c) => { const m = t.match(/(?<![A-Za-z])[a-z]{3,}(?![A-Za-z])/); return m && !c.sourceText.toLowerCase().includes(m[0]) ? m[0] : null; },
  // «مرفقة بعلبة» تغليف ظاهر ليس ادعاء قطعة أخرى؛ المعيب «مرفق به تنورة/بلوزة…».
  attached_item: (t, c) => (ATTACHED.test(t) && otherItem(t, c.name) ? t.slice(0, 60) : null),
  filler: (t) => (t.match(/(?:العديد من|مختلف|جميع|كل) (?:ال)?(?:مناسبات|أذواق|اذواق|أوقات|اوقات|إطلالات|اطلالات)/u) || [])[0] || null,
  cta: (t) => (t.match(/(?<!\p{L})(?:تسوقي|اطلبي|اطلبيها|سارعي|احصلي|لا تفوتي)(?!\p{L})/u) || [])[0] || null,
  repeated_sentence: (t) => {
    const seen = new Set();
    for (const s of t.split(/(?<=[.!؟])\s+|\n+/).map((x) => x.replace(/[^\p{L}\p{N}]+/gu, " ").trim()).filter((x) => x.split(" ").length >= 4)) {
      if (seen.has(s)) return s.slice(0, 60);
      seen.add(s);
    }
    return null;
  }
};
// ما يحذفه المعيار عمداً (2026-09-15) لا يُحسب قِصَراً: إحالة جدول مقاسات لم يذكره التاجر (٦.٧)، ومعجم الحشو (٧.٥)،
// ومناسبة لم يذكرها (٦.٢). الأساس = وصف الأرشيف بعد هذه الإزالات وحدها؛ الحذف الزائد من حراس آخرين يبقى مرصوداً.
function standardBaseline(c) {
  const src = c.sourceText;
  const d = String(c.page?.copywriting?.description || "");
  const noFiller = joinSentences(splitSentencesKeep(d).map((x) => ({ ...x, s: unsourcedJudgment(x.s, src) ? stripJudgments(x.s, { sourceText: src, name: c.name }) : x.s })));
  return dropUnsourcedOccasions(fixSizeChartClosing(noFiller, { name: c.name, category: CATEGORY_AR[c.category] || c.category, sourceText: src }), src);
}
// عنوان سطر ملاحظات مسرّب بالنثر — مفاتيح جدول المواصفات («سطح القماش: مطفي») أسماء صحيحة لا تسريب.
const NOTE_LABEL = /(?:الطابع العام|الطول والقصّة|الطول والقصة|سطح القماش)\s*:/u;

async function main() {
  const cases = readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(new URL(f, DIR), "utf8")));
  assert(cases.length >= 25, `CR-0: الأرشيف محمَّل (${cases.length} حالة حقيقية)`);
  const violations = Object.fromEntries([...Object.keys(CHECKS), "note_label", "short_description"].map((k) => [k, []]));
  for (const c of cases) {
    const p = runPipeline(c);
    for (const [field, text] of fieldsOf(p, c)) {
      for (const [check, fn] of Object.entries(CHECKS)) {
        const hit = fn(String(text), c);
        if (hit) violations[check].push(`${c.id}@${field}: «${String(hit).slice(0, 50)}»`);
      }
      if (!field.startsWith("spec") && NOTE_LABEL.test(String(text))) violations.note_label.push(`${c.id}@${field}`);
    }
    // وصف قصير بعد التنظيف عيب — إلا إن وصل الأرشيف قصيراً أصلاً (بعد إزالات المعيار العمدية)، أو وثّقت الحالة سببه بـknownIssues.
    if (words(p.copywriting?.description) < 20 && words(standardBaseline(c)) >= 20 && !c.knownIssues?.short_description) violations.short_description.push(`${c.id}: ${words(p.copywriting?.description)} كلمة (الأساس ${words(standardBaseline(c))})`);
  }
  for (const [check, list] of Object.entries(violations)) {
    assert(list.length === 0, `CR-${check}: صفر مخالفة «${check}» على أرشيف التوليدات الحقيقية${list.length ? ` — ${list.slice(0, 4).join(" | ")}` : ""}`);
  }
}

main().then(done);

// تلميع الصفحة كاملة — المالك 2026-09-12: «باقي بيانات الصفحة» لا الوصف وحده.
import { createRunner } from "../_helpers.mjs";
import { polishPage, pageText } from "../../functions/_lib/domain/copyPage.js";
import { generateProductCopy } from "../../functions/_lib/domain/copy.js";
import { detectLessons } from "../../functions/_lib/domain/copyLessons.js";

const { assert, done } = createRunner("page-polish");

const FAULTS = { cjk: "鞋", latin: "couche", cta: "تسوقي", agreement: "تنورة فضي ", attached: "مرفق بها بلوزة", paisley: "بايستيل", label: "الطابع العام", grammar: "هذا القطعة" };

const dirty = () => ({
  seo: {
    title: "تنورة فضي بطبعة بايستيل",
    seoTitle: "تنورة فضي couche تسوقي الآن",
    metaDescription: "تنورة فضي لامع بطبقات couche مرفق بها بلوزة، تسوقي الآن. هذا القطعة مناسبة للسهرات بكسرات طولية.",
    focusKeyword: "تنورة فضي",
    lsiKeywords: ["تنورة couche", "تنورة بايستيل"]
  },
  copywriting: {
    description: "تنورة بكسرات طولية دقيقة ولون فضي لامع وطول ميدي ينتهي عند منتصف الساق، مع خصر مطاطي عريض.\n\nتُلبس في السهرات مع توب أسود بسيط وصندل بكعب رفيع.\n\nراجعي جدول المقاسات قبل الطلب لاختيار المقاس المناسب.",
    excerpt: "تنورة فضي بطبقات couche وقب鞋 رياضي.",
    whatsapp: "تنورة فضي بايستيل مرفق بها بلوزة. هذا القطعة تُلبس للسهرات.",
    highlights: ["كسرات طولية couche دقيقة على كامل التنورة", "لون فضي بطبعة بايستيل لامعة", "هذا القطعة مرفق بها بلوزة سوداء", "تسوقي الآن قبل نفاد الكمية"],
    callToAction: "اطلبيها الآن"
  },
  specsTable: [{ key: "النقشة", value: "بايستيل couche" }, { key: "اللون", value: "فضي 鞋" }],
  faqs: [
    { q: "هل التنورة مرفق بها بلوزة؟", a: "نعم مرفق بها بلوزة سوداء." },
    { q: "ما نوع الطبعة؟", a: "طبعة بايستيل بلون فضي، هذا القطعة تناسب الطابع العام الهادئ." }
  ],
  imageAlt: "تنورة فضي بايستيل couche",
  tags: ["تنورة فضي", "couche", "بايستيل", "鞋"]
});

function leaksIn(parsed) {
  const out = {};
  const fields = {
    title: parsed.seo.title, seoTitle: parsed.seo.seoTitle, meta: parsed.seo.metaDescription, focus: parsed.seo.focusKeyword,
    lsi: parsed.seo.lsiKeywords.join(" | "), description: parsed.copywriting.description, excerpt: parsed.copywriting.excerpt,
    whatsapp: parsed.copywriting.whatsapp, highlights: parsed.copywriting.highlights.join(" | "),
    faqs: parsed.faqs.map((f) => `${f.q} ${f.a}`).join(" | "), specs: parsed.specsTable.map((r) => `${r.key} ${r.value}`).join(" | "),
    alt: parsed.imageAlt, tags: parsed.tags.join(" | ")
  };
  for (const [f, text] of Object.entries(fields)) {
    const hits = Object.entries(FAULTS).filter(([, needle]) => `${text} `.includes(needle)).map(([k]) => k);
    if (hits.length) out[f] = hits;
  }
  return out;
}

async function main() {
  {
    const p = polishPage(dirty(), { name: "تنورة", sourceText: "تنورة" });
    const leaks = leaksIn(p);
    assert(Object.keys(leaks).length === 0, `PP-1: لا حقل بالصفحة يحمل أخطاء الليلة (${JSON.stringify(leaks)})`);
    assert(p.faqs.length === 1 && !/مرفق/.test(p.faqs[0].a) && /بيزلي/.test(p.faqs[0].a), "PP-2: سؤال «مرفق بها بلوزة» يُحذف بسؤاله وجوابه، والآخر يُصحَّح");
    assert(p.copywriting.highlights.length === 2 && p.copywriting.highlights.every((h) => !/تسوقي|مرفق/.test(h)), `PP-3: نقطة دعوة البيع ونقطة القطعة المرفقة تُحذفان (${p.copywriting.highlights.join(" | ")})`);
    assert(p.seo.title.startsWith("تنورة فضية") && p.seo.seoTitle === "تنورة فضية طبقة" && p.tags.includes("تنورة فضية") && !p.tags.includes(""), `PP-4: العناوين والوسوم تُصحَّح ولا تُفرَّغ («${p.seo.title}» · «${p.seo.seoTitle}»)`);
  }
  {
    const p = polishPage({ seo: { title: "تسوقي الآن", seoTitle: "", metaDescription: "", jsonLdSchema: { description: "قديم" } }, copywriting: {}, faqs: [], tags: [] }, { name: "فستان أسود" });
    assert(p.seo.title === "فستان أسود" && p.seo.seoTitle === "فستان أسود" && p.seo.jsonLdSchema.description === "", "PP-5: عنوان يفرغ بعد التلميع يعود لاسم المنتج، وJSON-LD يتبع الميتا");
  }
  {
    const text = pageText(dirty());
    const codes = detectLessons({ draft: text, final: pageText(polishPage(dirty(), { name: "تنورة", sourceText: "تنورة" })), sourceText: "تنورة" }).map((l) => l.code);
    assert(codes.includes("LATIN_WORD") && codes.includes("FOREIGN_SCRIPT") && codes.includes("SALES_CTA") && codes.includes("GRAMMAR") && codes.includes("TERM"), `PP-6: الذاكرة تتعلم من أخطاء كل حقول الصفحة (${codes.join(",")})`);
  }
  {
    const AI = { run: async () => ({ response: JSON.stringify(dirty()) }) };
    const res = await generateProductCopy({ env: { AI }, merchantId: "m_1", name: "تنورة", price: "", tone: "white", category: "", features: "", existingDescription: "", imageUrl: "", keywordsExtra: [] });
    const leaks = leaksIn(res);
    assert(Object.keys(leaks).length === 0, `PP-7: التوليد الكامل ينشر صفحة نظيفة بكل حقولها (${JSON.stringify(leaks)})`);
  }
}

main().then(done);

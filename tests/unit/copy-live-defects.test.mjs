// صفحتان حقيقيتان من الإنتاج بعد نشر copyOccasion.js (2026-09-15) — تنورة وبنطلون — تُمرَّران على سلسلة ما بعد
// التوليد نفسها بلا نداء نموذج: cleanDescription → polishPage → applyVisionFacts → stripUnsourcedOccasions →
// preserveMerchantFacts. العيوب: كشف آلية («في النموذج المعروض»)، إحالة مقاسات («راجع القياسات المعروضة»)،
// وصف بنية الخيارات («ألوان المتجر المسجلة تحت الخيارات»)، ميزة التاجر غائبة عن الوصف، «بنطلون ماكسي»،
// «نقشتها منقوشة»، «جيوب عملية».
import { createRunner } from "../_helpers.mjs";
import { polishPage } from "../../functions/_lib/domain/copyPage.js";
import { applyVisionFacts } from "../../functions/_lib/domain/visionFacts.js";
import { stripUnsourcedOccasions } from "../../functions/_lib/domain/copyOccasion.js";
import { preserveMerchantFacts } from "../../functions/_lib/domain/copyFacts.js";
import { cleanDescription, cleanPublishedFields } from "../../functions/_lib/domain/copyParse.js";
import { fixSizeChartClosing } from "../../functions/_lib/domain/copyClaims.js";
import { dropMechanismClauses, dropEmptyQualifiers } from "../../functions/_lib/domain/copyLeaks.js";

const { assert, done } = createRunner("copy-live-defects");

function run({ name, features = "", variants = [], notes, facts, page }) {
  const sourceText = [name, features, "", JSON.stringify(variants)].join(" ");
  const p = JSON.parse(JSON.stringify(page));
  p.copywriting.description = cleanDescription(p.copywriting.description, { sourceText, productName: name });
  polishPage(p, { name, sourceText, notes, category: "" });
  stripUnsourcedOccasions(applyVisionFacts(p, facts, { name }), { sourceText, name });
  preserveMerchantFacts(p, { name, features, existingDescription: "", variants });
  return p;
}
const shell = (cw) => ({ copywriting: { whatsapp: "", ...cw }, seo: {}, faqs: [], specsTable: [], tags: [] });

// ── الصفحة ١: تنورة ────────────────────────────────────────────────────────────
const skirt = run({
  name: "تنورة",
  variants: [{ name: "اللون", values: ["رمادي", "بنفسجي"] }, { name: "المقاس", values: ["36", "38", "40", "42", "44"] }],
  notes: "الطول: ميدي. القصّة: واسعة. التفاصيل: طبقات. سطح القماش: مطفي. النقشة: منقوش. الطابع العام: نهاري.",
  facts: { length: "ميدي", fit: "واسعة", details: ["طبقات"], surface: "مطفي", pattern: "منقوش", mood: "نهاري" },
  page: shell({
    description: "تنورة ميدي بقصّة واسعة، بطبقات وقماش مطفي. يظهر التصميم باللون الرمادي في النموذج المعروض، وتتوافر التنورة بالرمادي والبنفسجي.\n\nتتوفر المقاسات من 36 إلى 44، مع قياسات مختلفة لنصف محيط الخصر والطول حسب المقاس. راجع القياسات المعروضة للعثور على المقاس المناسب لك.",
    excerpt: "تنورة ميدي بقصّة واسعة وطبقات واضحة، سطحها مطفي ونقشتها منقوشة.",
    highlights: ["قصّة واسعة بطول ميدي وطبقات واضحة", "سطح مطفي مع نقشة منقوشة", "متوفرة باللونين الرمادي والبنفسجي"]
  })
});
const s = skirt.copywriting;
assert(s.description === "تنورة ميدي بقصّة واسعة، بطبقات وقماش مطفي. تتوافر التنورة بالرمادي والبنفسجي.\n\nتتوفر المقاسات من 36 إلى 44، مع قياسات مختلفة لنصف محيط الخصر والطول حسب المقاس.",
  `LD-1: وصف التنورة بلا «النموذج المعروض» ولا «راجع القياسات»، والألوان والمقاسات باقية («${s.description}»)`);
assert(s.excerpt === "تنورة ميدي بقصّة واسعة وطبقات، سطحها مطفي.", `LD-2: النبذة بلا «واضحة» ولا «نقشتها منقوشة» («${s.excerpt}»)`);
assert(JSON.stringify(s.highlights) === JSON.stringify(["قصّة واسعة بطول ميدي وطبقات", "متوفرة باللونين الرمادي والبنفسجي"]),
  `LD-3: نقطة «سطح مطفي مع نقشة منقوشة» صارت كلمتين فحُذفت، و«طبقات واضحة» ⇒ «طبقات» (${JSON.stringify(s.highlights)})`);

// ── الصفحة ٢: بنطلون ───────────────────────────────────────────────────────────
const trousers = run({
  name: "بنطلون",
  features: "قطن 100% خفيف وبارد صيفي",
  variants: [{ name: "المقاس", values: ["36 - XS", "38 - S", "40 - M", "42 - L", "44 - XL"] }],
  notes: "اللون: زيتي. الطول: ماكسي. القصّة: واسعة. الخصر: مرتفع. التفاصيل: كسرات عريضة، جيوب. سطح القماش: مطفي. النقشة: سادة.",
  facts: { color: "زيتي", length: "ماكسي", fit: "واسعة", waist: "مرتفع", details: ["كسرات عريضة", "جيوب"], surface: "مطفي", pattern: "سادة" },
  page: shell({
    description: "بنطلون ماكسي زيتي بقصّة واسعة وخصر مرتفع، بكسرات عريضة وجيوب وقماش مطفي.\n\nيتوفر البنطلون بالمقاسات XS وS وM وL وXL، وبألوان المتجر المسجلة تحت الخيارات من 36 إلى 44. اختَر المقاس المناسب لك من الخيارات المتاحة.",
    excerpt: "بنطلون زيتي بقصّة واسعة وخصر مرتفع، مصنوع من قطن 100% خفيف وبارد صيفي، مع كسرات عريضة وجيوب ومقاسات من XS إلى XL.",
    highlights: ["قطن 100% خفيف وبارد صيفي", "قصّة واسعة مع خصر مرتفع", "كسرات عريضة وجيوب عملية"]
  })
});
const t = trousers.copywriting;
assert(t.description === "بنطلون زيتي بطول كامل وقصّة واسعة وخصر مرتفع، بكسرات عريضة وجيوب وقماش مطفي. مصنوع من قطن 100% خفيف وبارد صيفي.\n\nيتوفر البنطلون بالمقاسات XS وS وM وL وXL.",
  `LD-4: وصف البنطلون: «بطول كامل» لا «ماكسي»، ميزة التاجر بالفقرة الأولى، بلا «ألوان المتجر المسجلة» ولا «اختَر المقاس» («${t.description}»)`);
assert(JSON.stringify(t.highlights) === JSON.stringify(["قطن 100% خفيف وبارد صيفي", "قصّة واسعة مع خصر مرتفع", "كسرات عريضة وجيوب"]),
  `LD-5: «جيوب عملية» ⇒ «جيوب» (${JSON.stringify(t.highlights)})`);
assert(trousers.seo.title === "بنطلون زيتي بكسرات عريضة" && !/ماكسي/.test(JSON.stringify(trousers)),
  `LD-6: لا «ماكسي» بأي حقل لبنطلون، والعنوان «${trousers.seo.title}»`);
assert(trousers.specsTable.some((r) => r.key === "الطول" && r.value === "كامل"), "LD-7: صف الطول للبنطلون «كامل» لا «ماكسي»");
{
  const midi = applyVisionFacts(shell({ description: "بنطلون ميدي أسود." }), { color: "أسود", length: "ميدي", fit: "واسعة" }, { name: "بنطلون" });
  assert(!/ميدي/.test(JSON.stringify(midi)), `LD-8: بنطلون «ميدي» ⇒ الطول يُسقط من الافتتاح والعنوان والمواصفات («${midi.copywriting.description}»)`);
  const dress = applyVisionFacts(shell({ description: "فستان." }), { color: "أسود", length: "ماكسي", fit: "واسعة" }, { name: "فستان" });
  assert(/^فستان ماكسي أسود/.test(dress.copywriting.description), `LD-9: الفستان يبقى «ماكسي» (${dress.copywriting.description})`);
}

// ── ميزة التاجر بالوصف: بلا تكرار، وصيغ لا تُكتب سليمة تُترك ────────────────────────
{
  const p = shell({ description: "بنطلون أسود من قطن 100% خفيف وبارد صيفي." });
  preserveMerchantFacts(p, { name: "بنطلون", features: "قطن 100% خفيف وبارد صيفي" });
  assert(p.copywriting.description === "بنطلون أسود من قطن 100% خفيف وبارد صيفي.", "LD-10: الميزة موجودة بالوصف ⇒ لا تُضاف مرة ثانية");
  const q = shell({ description: "تنورة سوداء بقصّة واسعة.\n\nتتوفر بمقاسات S وM." });
  preserveMerchantFacts(q, { name: "تنورة", features: "خفيف ومريح" });
  assert(q.copywriting.description === "تنورة سوداء بقصّة واسعة. التنورة خفيفة ومريحة.\n\nتتوفر بمقاسات S وM.", `LD-11: صفة من التاجر تُطابق اسماً مؤنثاً وتُلحق بالفقرة الأولى («${q.copywriting.description}»)`);
  const w = shell({ description: "عسل سدر جبلي بلون كهرماني." });
  preserveMerchantFacts(w, { name: "عسل سدر", features: "الوزن: 500 جرام؛ المنشأ: اليمن" });
  assert(w.copywriting.description === "عسل سدر جبلي بلون كهرماني.", "LD-12: مزايا تبدأ برقم («500 جرام») لا تُصاغ جملة — تبقى للمواصفات");
}

// ── سلبي: الحقائق لا تُحذف ─────────────────────────────────────────────────────
{
  const facts = "تتوفر المقاسات من 36 إلى 44، مع قياسات مختلفة لنصف محيط الخصر والطول حسب المقاس.";
  assert(fixSizeChartClosing(facts, { name: "تنورة" }) === facts, "LD-13: قائمة المقاسات الحقيقية مع القياسات لا تُعد إحالة");
  assert(fixSizeChartClosing("تتوفر التنورة بالأسود والبيج من الخيارات المتاحة.", { name: "تنورة" }) === "تتوفر التنورة بالأسود والبيج.", "LD-14: «من الخيارات المتاحة» ذيل يُحذف وحده والألوان تبقى");
  assert(fixSizeChartClosing("فستان كحلي. اختاري مقاسك قبل الطلب.", { name: "فستان", sourceText: "جدول المقاسات بالصور" }) === "فستان كحلي.", "LD-15: دعوة «اختاري مقاسك» تُحذف ولو ذكر التاجر جدوله");
  assert(dropMechanismClauses("تتوافر التنورة بالرمادي والبنفسجي.") === "تتوافر التنورة بالرمادي والبنفسجي.", "LD-16: توفّر الألوان وحده ليس كشف آلية");
  assert(dropMechanismClauses("تظهر القطعة المعروضة باللون الأسود.") === "", "LD-17: جملة تصف القطعة المعروضة وحدها تُحذف");
  assert(dropEmptyQualifiers("بنطلون بجيوب عملية.", "بنطلون بجيوب عملية") === "بنطلون بجيوب عملية.", "LD-18: «جيوب عملية» كتبها التاجر ⇒ تبقى");
  assert(dropEmptyQualifiers("فستان بخطوط واضحة ولون سادة.") === "فستان بخطوط واضحة ولون سادة.", "LD-19: «واضحة» على غير تفصيل من القائمة لا تُمس");
}
// ── كشف الآلية يُرصد عيباً بالحقول المنشورة ─────────────────────────────────────
{
  const p = shell({ description: "تنورة رمادية.", excerpt: "", highlights: ["اللون الرمادي في النموذج المعروض بطبقات"] });
  const r = cleanPublishedFields(p, { sourceText: "تنورة", name: "تنورة" });
  const hs = (r?.copywriting || p.copywriting).highlights || [];
  assert(!hs.some((h) => /النموذج المعروض/.test(h)), `LD-20: نقطة فيها «النموذج المعروض» لا تُنشر (${JSON.stringify(hs)})`);
}

done();

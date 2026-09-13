// صفحة تنورة حقيقية كتبها Cloudflare بعد تجدد حصته (2026-09-13 01:01): أخطاء آلية تُصلَح بالكود مهما كان النموذج.
import { createRunner } from "../_helpers.mjs";
import { polishPage } from "../../functions/_lib/domain/copyPage.js";

const { assert, done } = createRunner("page-cleanup");

const VARIANTS = JSON.stringify([{ name: "المقاس", values: ["44 - XL", "42 - L", "40 - M", "38 - S", "36 - XS"] }]);

async function main() {
  const page = {
    copywriting: {
      description: "تنورة ميدي سوداء بقصّة واسعة، بكسرات عريضة وقماش لامع.\n\nتُلبس هذه التنورة في المناسبات الرسمية ويمكن تنسيقها مع بلوزة بيضاء أو قميص رسمي.",
      excerpt: "تنورة سوداء ميدي بقصّة واسعة، بكسرات عريضة وقماش لامع. متوفرة بمقاسات من 36 - XL. تنورة سوداء ميدي بقصّة واسعة، بكسرات عريضة وقماش لامع.",
      whatsapp: "تنورة سوداء ميدي بقصّة واسعة، بكسرات عريضة وقماش لامع. متوفرة بمقاسات من 36 - XL. راسليني للطلب!",
      highlights: ["تنورة ميدي سوداء بكسرات عريضة", "تنورة سوداء ميدي بقصّة واسعة", "قماش لامع يضفي طابعاً رسمياً"]
    },
    seo: { title: "تنورة ميدي سوداء بكسرات عريضة", seoTitle: "تنورة سوداء ميدي بقصّة واسعة", metaDescription: "تنورة سوداء ميدي بقصّة واسعة، بكسرات عريضة وقماش لامع. متوفرة بمقاسات من 36 - XL. تنورة سوداء ميدي بقصّة واسعة، بكسرات عريضة وقماش لامع.", lsiKeywords: [] },
    faqs: [{ q: "ما هي المقاسات المتاحة؟", a: "متوفرة بمقاسات من 36 - XL." }, { q: "ما هو لون التنورة؟", a: "اللون أسود." }],
    specsTable: [{ key: "المقاس", value: "36 - XL" }, { key: "اللون", value: "أسود" }],
    imageAlt: "تنورة ميدي سوداء بكسرات عريضة",
    tags: ["تنورة سوداء", "تنورة ميدي", "قصّة واسعة", "قماش لامع", "أسود", "ميدي", "واسعة", "تنورة"]
  };
  polishPage(page, { name: "تنورة", sourceText: `تنورة  ${VARIANTS}`, notes: "اللون: أسود. الطول: ميدي. القصّة: واسعة. التفاصيل: كسرات عريضة. سطح القماش: لامع.", category: "البلايز" });

  assert(page.copywriting.excerpt === "تنورة سوداء ميدي بقصّة واسعة، بكسرات عريضة وقماش لامع. متوفرة بمقاسات من 36 (XS) إلى 44 (XL).", `PC-1: جملة مكررة داخل النبذة تُحذف، والمدى يُبنى من خيارات التاجر («${page.copywriting.excerpt}»)`);
  assert(page.seo.metaDescription.split("تنورة سوداء ميدي بقصّة واسعة").length === 2, "PC-2: الميتا بلا جملة مكررة");
  assert(page.faqs.length === 1 && /36 \(XS\) إلى 44 \(XL\)/.test(page.faqs[0].a), `PC-3: جواب «اللون أسود.» يُحذف، وجواب المقاسات يصحّح مداه (${JSON.stringify(page.faqs)})`);
  assert(page.specsTable.find((r) => r.key === "المقاس")?.value === "36 (XS) إلى 44 (XL)", "PC-4: مواصفة «36 - XL» تصير المدى الحقيقي");
  assert(JSON.stringify(page.copywriting.highlights) === JSON.stringify(["تنورة سوداء ميدي بقصّة واسعة", "قماش لامع يضفي طابعاً رسمياً"]), `PC-5: نقطة تعيد العنوان حرفياً تُحذف، وما يضيف معلومة خارج العنوان يبقى (${JSON.stringify(page.copywriting.highlights)})`);
  assert(JSON.stringify(page.tags) === JSON.stringify(["تنورة سوداء", "تنورة ميدي", "قصّة واسعة", "قماش لامع", "تنورة"]), `PC-6: وسوم الصفة المفردة («أسود»، «ميدي»، «واسعة») تُحذف (${JSON.stringify(page.tags)})`);

  const filler = { copywriting: { description: "فستان ميدي أخضر.\n\nهذا الفستان مناسب للمناسبات النهارية، ويمكن ارتداؤه في العديد من المناسبات غير الرسمية. يمكن تنسيقه مع حذاء مسطح.", excerpt: "تُلبس في المناسبات اليومية والغير رسمية.", whatsapp: "" }, seo: {}, faqs: [], specsTable: [], tags: [] };
  polishPage(filler, { name: "فستان", sourceText: "فستان", notes: "" });
  assert(/مناسب للمناسبات النهارية\. يمكن تنسيقه مع حذاء مسطح\./.test(filler.copywriting.description) && !/العديد من المناسبات/.test(filler.copywriting.description), `PC-8: حشو «ويمكن ارتداؤه في العديد من المناسبات غير الرسمية» يُحذف وتبقى الجملة («${filler.copywriting.description}»)`);
  assert(filler.copywriting.excerpt === "تُلبس في المناسبات اليومية وغير الرسمية.", `PC-9: «والغير رسمية» ⇒ «وغير الرسمية» («${filler.copywriting.excerpt}»)`);

  const general = { copywriting: { description: "فستان ميدي أخضر بقصّة واسعة وتصميم، بكشكش عند الذيل.\n\nتناسب جميع المناسبات. تُنسّق مع حذاء مسطح لمختلف الإطلالات.", excerpt: "عباية سوداء بتطريز يدوي تناسب جميع الإطلالات الرسمية.", whatsapp: "" }, seo: {}, faqs: [], specsTable: [], tags: [] };
  polishPage(general, { name: "فستان", sourceText: "فستان", notes: "" });
  assert(!/جميع المناسبات|مختلف الإطلالات|وتصميم،/.test(general.copywriting.description) && /بقصّة واسعة، بكشكش عند الذيل\./.test(general.copywriting.description) && /تُنسّق مع حذاء مسطح\./.test(general.copywriting.description), `PC-10: حشو المناسبات بلا حكم مجاور يُحذف، و«وتصميم،» المعلّقة تُزال («${general.copywriting.description}»)`);
  assert(general.copywriting.excerpt === "عباية سوداء بتطريز يدوي.", `PC-11: «تناسب جميع الإطلالات الرسمية» تُحذف مع صفتها («${general.copywriting.excerpt}»)`);

  const skirtReal = { copywriting: { description: "تنورة ميدي سوداء وأبيض بقصّة مستقيمة ورباط عند الخصر، بطيّات بليسيه ونقشة مورّدة وقماش مطفي.", excerpt: "", whatsapp: "" }, seo: {}, faqs: [], specsTable: [], tags: [] };
  polishPage(skirtReal, { name: "تنورة", sourceText: "تنورة", notes: "اللون: أسود وأبيض. الخصر: برباط. التفاصيل: بليسيه. النقشة: مورد." });
  assert(skirtReal.copywriting.description.startsWith("تنورة ميدي سوداء وبيضاء برباط عند الخصر، بطيّات بليسيه"), `PC-22: «سوداء وأبيض» تؤنَّث مع فاصل، وحذف «بقصّة مستقيمة» غير المرئية يعيد «برباط» لا «ورباط» («${skirtReal.copywriting.description}»)`);

  const nexosPage = { copywriting: { description: "فستان سهرة بنفسجي بذيل بطول ماكسي.", excerpt: "", whatsapp: "", highlights: ["اللون البنفسجي يلفت النظر في السهرات", "الطول الماكسي يمنح الإطلالة امتداداً واضحاً", "الشق الجانبي يضيف تفصيلاً بارزاً للتنورة", "فتحة ظهر وشق جانبي بالتنورة"] },
    seo: { metaDescription: "فستان سهرة بنفسجي بذيل، بقصّة ضيقة ولمسة لامعة وفتحة ظهر وشق جانبي. راجعي جدول المقاسات قبل الطلب. فستان سهرة بنفسجي بذيل، بقصّة ضيقة وياقة" },
    faqs: [{ q: "ما تفاصيل قصّة الفستان؟", a: "الفستان بطول ماكسي وقصّة ضيقة، وياقة دائرية وأكمام بلا أكمام." }], specsTable: [], tags: [] };
  polishPage(nexosPage, { name: "فستان سهرة بنفسجي بذيل", sourceText: "فستان سهرة بنفسجي بذيل فتحة ظهر شق جانبي", notes: "اللون: بنفسجي. الطول: ماكسي. القصّة: ضيقة. الياقة: دائرية. الأكمام: بلا أكمام. سطح القماش: لامع." });
  assert(nexosPage.seo.metaDescription === "فستان سهرة بنفسجي بذيل، بقصّة ضيقة ولمسة لامعة وفتحة ظهر وشق جانبي. راجعي جدول المقاسات قبل الطلب.", `PC-23: ميتا بتكملة تعيد الافتتاح تُقطع عند التكرار وتنتهي بجملة تامة («${nexosPage.seo.metaDescription}»)`);
  assert(nexosPage.faqs[0]?.a === "الفستان بطول ماكسي وقصّة ضيقة، وياقة دائرية وبلا أكمام.", `PC-24: «وأكمام بلا أكمام» ⇒ «وبلا أكمام» («${nexosPage.faqs[0]?.a}»)`);
  const nexosHl = nexosPage.copywriting.highlights.join(" | ");
  assert(nexosHl === "فتحة ظهر وشق جانبي بالتنورة", `PC-25: نقطة مبنية على تعبير مدح تُحذف كاملة لا تبقى بقايا («${nexosHl}»)`);

  {
    const { cleanPublishedFields } = await import("../../functions/_lib/domain/copyParse.js");
    const full = { copywriting: { description: "فستان سهرة بنفسجي بذيل.", highlights: ["اللون البنفسجي يلفت النظر في السهرات", "الطول الماكسي يمنح الإطلالة امتداداً واضحاً", "فتحة ظهر وشق جانبي بالتنورة"] }, seo: {}, faqs: [], specsTable: [], tags: [] };
    const src = "فستان سهرة بنفسجي بذيل فتحة ظهر شق جانبي";
    cleanPublishedFields(full, { sourceText: src, name: "فستان سهرة بنفسجي بذيل" });
    polishPage(full, { name: "فستان سهرة بنفسجي بذيل", sourceText: src, notes: "" });
    assert(full.copywriting.highlights.join(" | ") === "فتحة ظهر وشق جانبي بالتنورة", `PC-26: السلسلة كاملة (cleanPublishedFields ثم polishPage) لا تترك بقايا نقطة مدح («${full.copywriting.highlights.join(" | ")}»)`);
  }

  const valid = { copywriting: { description: "تنورة.", excerpt: "متوفرة بمقاسات من 36 - XS إلى 44 - XL.", whatsapp: "" }, seo: {}, faqs: [], specsTable: [], tags: [] };
  polishPage(valid, { name: "تنورة", sourceText: `تنورة ${VARIANTS}`, notes: "" });
  assert(valid.copywriting.excerpt === "متوفرة بمقاسات من 36 - XS إلى 44 - XL.", "PC-7: مدى صحيح من خيارات التاجر لا يُمس");

  // ── حالات صناعية 2026-09-13: طبقة الأحكام لكل الحقول، والحراس التي كانت لحقل واحد ─────────────────
  const { stripJudgmentWords, stripJudgments } = await import("../../functions/_lib/domain/copyJudgments.js");
  const { cleanPublishedFields } = await import("../../functions/_lib/domain/copyParse.js");
  const { dropSalesCta, fixColorAgreement } = await import("../../functions/_lib/domain/copyPhrases.js");
  const { dropPhotoLeaks } = await import("../../functions/_lib/domain/copyNotes.js");
  const { sizeChartKind } = await import("../../functions/_lib/domain/copyClaims.js");
  assert(stripJudgmentWords("فستان سهرة كلوش ساحر", "فستان سهرة") === "فستان سهرة كلوش" && stripJudgmentWords("سوار فولاذي ثلاثي راقٍ", "") === "سوار فولاذي ثلاثي", "PC-12: حكم العنوان يُزال بكلمته، و«راقٍ» بتنوين الكسر لا تفلت");
  assert(stripJudgmentWords("قماش قطن مريح جداً", "بلوزة قطن مريحة") === "قماش قطن مريح جداً" && stripJudgmentWords("سوار بلمعة براقة", "") === "سوار بلمعة براقة", "PC-13: «مريح» التي ذكرها التاجر تبقى، و«براقة» لمعة لا «راقٍ»");
  const hl = cleanPublishedFields({ copywriting: { description: "", highlights: ["عباية كحلي بقماش كريب فاخر"] }, seo: {} }, { sourceText: "عباية كحلي كريب", name: "عباية" });
  assert(JSON.stringify(hl.copywriting.highlights) === JSON.stringify(["عباية كحلي بقماش كريب"]), `PC-14: نقطة فيها حكم تفقد الكلمة لا النقطة كلها (${JSON.stringify(hl.copywriting.highlights)})`);
  const praise = stripJudgments("قميص أزرق فاتح قطن مريح، شكله راقٍ ويناسب كل المناسبات.", { sourceText: "قميص قطن مريح", name: "قميص" });
  assert(praise === "قميص أزرق فاتح قطن مريح.", `PC-15: مقطع المدح الخالص («شكله راقٍ…») يُحذف وتبقى الحقيقة («${praise}»)`);
  assert(dropSalesCta("عطر ورد عود، حجم 100 مل، الحقي بطلبك الآن.") === "عطر ورد عود، حجم 100 مل.", "PC-16: دعوة البيع بلهجة تُحذف بمقطعها لا بجملتها");
  assert(sizeChartKind({ name: "ثوب سعودي رجالي" }) === "sized" && sizeChartKind({ name: "دهن عود كمبودي" }) === "none", "PC-17: «عود» داخل «سعودي» لا يُسقط جدول مقاسات الثوب");
  assert(dropPhotoLeaks("حذاء رياضي رمادي بنعل مطاطي. تظهر العارضة واقفة على أرضية خشبية.", "حذاء رياضي") === "حذاء رياضي رمادي بنعل مطاطي." && dropPhotoLeaks("تنورة ميدي صفراء بكسرات كشكش مع بنطلون جينز فضفاض تحتها.", "تنورة ميدي") === "تنورة ميدي صفراء بكسرات كشكش.", "PC-18: مشهد التصوير وقطعة العارضة «تحتها» يُحذفان من النص المنشور");
  assert(dropPhotoLeaks("تنورة ميدي صفراء. تُنسَّق مع بنطلون جينز وحذاء مسطح.", "تنورة ميدي") === "تنورة ميدي صفراء. تُنسَّق مع بنطلون جينز وحذاء مسطح.", "PC-19: اقتراح التنسيق مع قطعة أخرى يبقى");
  assert(fixColorAgreement("تنورة أسود وأبيض") === "تنورة سوداء وبيضاء" && fixColorAgreement("عباية متعدد الألوان") === "عباية متعددة الألوان" && fixColorAgreement("بلون متعدد") === "بلون متعدد", "PC-20: اللون المعطوف و«متعدد الألوان» يطابقان القطعة المؤنثة");
  const specs = { copywriting: {}, seo: {}, faqs: [], tags: [], specsTable: [{ key: "لون العباية", value: "متعدد الألوان" }, { key: "اللون", value: "أسود" }] };
  polishPage(specs, { name: "تنورة", sourceText: "تنورة" });
  const bag = { copywriting: {}, seo: {}, faqs: [], tags: [], specsTable: [{ key: "حزام الكتف", value: "قابل للتعديل" }] };
  polishPage(bag, { name: "حقيبة كتف", sourceText: "حقيبة كتف" });
  assert(specs.specsTable.length === 1 && specs.specsTable[0].key === "اللون" && bag.specsTable.length === 1, `PC-21: مواصفة قطعة أخرى تُحذف، و«حزام الكتف» للحقيبة يبقى (${JSON.stringify(specs.specsTable)})`);
}

main().then(done);

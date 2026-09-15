// ادعاءات غير مسندة وخاتمة المقاسات — من تقييم الجودة التجارية 2026-09-12 (عيوب مؤكدة حقيقية).
import { createRunner } from "../_helpers.mjs";
import { unsourcedClaims, fixSizeChartClosing, sizeChartKind } from "../../functions/_lib/domain/copyClaims.js";
import { polishPage } from "../../functions/_lib/domain/copyPage.js";

const { assert, done } = createRunner("copy-claims");

async function main() {
  {
    const watch = "ساعة رجالية بوس كلوب ستانلس ستيل؛ قطر الساعة 40 ملم؛ حركة كوارتز؛ ضمان 3 سنوات";
    assert(unsourcedClaims("الساعة مقاومة للماء بشكل يومي، غير مناسبة للسباحة.", watch).includes("WATER_RESISTANCE"), "CC-1: مقاومة الماء بلا مصدر تُرصد (ساعة حقيقية)");
    assert(!unsourcedClaims("مع ضمان 3 سنوات من المتجر.", watch).includes("WARRANTY") && unsourcedClaims("مع ضمان سنتين.", "ساعة").includes("WARRANTY"), "CC-2: الضمان مسموح إن ذكره التاجر، ومرصود إن لم يذكره");
    assert(unsourcedClaims("خاتم ذهب عيار 21 أصلي.", "خاتم ذهب عيار 21").includes("AUTHENTIC") && unsourcedClaims("ثبات يدوم طوال اليوم بمكونات طبيعية.", "عطر 100 مل").join(",") === "NATURAL,LONGEVITY", "CC-3: «أصلي» و«ثبات يدوم» و«طبيعية» بلا مصدر تُرصد");
    assert(unsourcedClaims("اطلب خاتمك الآن قبل ما ينفد.", "").includes("SCARCITY") && unsourcedClaims("عباية بمقاس واحد يناسب الجميع.", "عباية").includes("ONE_SIZE"), "CC-4: الندرة و«مقاس واحد» تُرصدان");
    assert(unsourcedClaims("سوار فولاذي بلمسة مطفية وثلاثة عقارب.", "ساعة").length === 0, "CC-5: وصف مرئي عادي بلا ادعاء لا يُرصد");
    assert(unsourcedClaims("تنسيقها سهل مع بلوزة رسمية، وتناسب كل المواسم.", "تنورة ميدي سوداء").includes("ALL_SEASONS") && unsourcedClaims("خامة خفيفة تناسب جميع الفصول.", "").includes("ALL_SEASONS") && !unsourcedClaims("تناسب كل المواسم.", "تنورة صيفية وشتوية").includes("ALL_SEASONS") && !unsourcedClaims("تنسيقها سهل مع بلوزة رسمية.", "").length, "CC-5b: «تناسب كل المواسم» بلا مصدر تُرصد (توليد حقيقي 2026-09-12)، ومسموحة إن ذكر التاجر الموسم");
  }
  {
    const perfume = "عطر بخور بزجاجة شفافة.\n\nراجعي جدول المقاسات قبل الطلب لاختيار المقاس المناسب.";
    assert(fixSizeChartClosing(perfume, { name: "عطر مونتال بخور 100 مل", category: "عطور" }) === "عطر بخور بزجاجة شفافة.", "CC-6: جملة جدول المقاسات تُحذف من عطر");
    assert(fixSizeChartClosing("ثوب رمادي.\n\nراجعي جدول المقاسات قبل الطلب.", { name: "ثوب مغربي رجالي رصاصي", sourceText: "ثوب مغربي رجالي؛ جدول المقاسات مرفق بالصور" }) === "ثوب رمادي.\n\nراجع جدول المقاسات قبل الطلب.", "CC-7: التاجر ذكر جدول المقاسات ⇒ تبقى الخاتمة لثوب رجالي بصيغة المذكر");
    assert(fixSizeChartClosing("ثوب رمادي.\n\nراجعي جدول المقاسات قبل الطلب.", { name: "ثوب مغربي رجالي رصاصي" }) === "ثوب رمادي.", "CC-7b: التاجر لم يذكر جدول مقاسات ⇒ الإحالة إليه تُحذف حتى للملابس (معيار ٦.٧، 2026-09-15)");
    assert(sizeChartKind({ name: "فستان شادن كحلي" }) === "sized" && sizeChartKind({ name: "خاتم ذهب وردة" }) === "none" && sizeChartKind({ name: "ساعة رجالية" }) === "none" && sizeChartKind({ name: "شماغ أحمر", category: "أزياء رجالية" }) === "none", "CC-8: الملابس بجدول مقاسات، والخاتم والساعة والشماغ بلا جدول");
  }
  {
    const page = {
      seo: { title: "ساعة رجالية بوس كلوب", seoTitle: "ساعة رجالية بوس كلوب", metaDescription: "ساعة رجالية بوس كلوب ستانلس ستيل مقاومة للماء بقرص فيروزي. حركة كوارتز دقيقة." },
      copywriting: {
        description: "ساعة رجالية بقرص فيروزي وسوار فولاذي بثلاثة صفوف.\n\nتُلبس في الدوام والمناسبات. مقاومة للخدوش ولا يتغير لونها.\n\nراجعي جدول المقاسات قبل الطلب لاختيار المقاس المناسب.",
        excerpt: "ساعة رجالية بقرص فيروزي.", whatsapp: "ساعة بقرص فيروزي، ضمان سنتين من الوكيل الرسمي.",
        highlights: ["قرص فيروزي بأرقام رومانية", "مقاومة للماء حتى 3 ATM", "سوار فولاذي بثلاثة صفوف"], callToAction: "اطلبها الآن قبل ما تنفد"
      },
      faqs: [{ q: "هل الساعة مقاومة للماء؟", a: "نعم، مناسبة للرذاذ لا للسباحة." }, { q: "ما قطر الساعة؟", a: "40 ملم." }],
      specsTable: [{ key: "مقاومة الماء", value: "3 ATM" }, { key: "القطر", value: "40 ملم" }],
      tags: ["ساعة رجالية", "مقاومة للماء"]
    };
    const p = polishPage(page, { name: "ساعة رجالية بوس كلوب ستانلس ستيل", sourceText: "ساعة رجالية بوس كلوب ستانلس ستيل؛ قطر 40 ملم؛ حركة كوارتز؛ ضمان 3 سنوات", category: "ساعات" });
    const all = JSON.stringify(p);
    assert(!/مقاوم|ATM|للسباحة|الوكيل الرسمي|تنفد|لا يتغير/.test(all), `CC-9: لا ادعاء غير مسند بأي حقل من صفحة الساعة (${all.match(/مقاوم|ATM|للسباحة|الوكيل الرسمي|تنفد|لا يتغير/)?.[0] || ""})`);
    assert(!/جدول المقاسات/.test(p.copywriting.description) && p.faqs.length === 1 && p.copywriting.highlights.length === 2 && p.specsTable.length === 1 && p.tags.join() === "ساعة رجالية" && p.copywriting.callToAction === "", "CC-10: السؤال والنقطة والمواصفة والوسم ذات الادعاء تُحذف، وجدول المقاسات يُحذف من ساعة");
  }
}

main().then(done);

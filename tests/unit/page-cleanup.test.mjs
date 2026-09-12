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

  const valid = { copywriting: { description: "تنورة.", excerpt: "متوفرة بمقاسات من 36 - XS إلى 44 - XL.", whatsapp: "" }, seo: {}, faqs: [], specsTable: [], tags: [] };
  polishPage(valid, { name: "تنورة", sourceText: `تنورة ${VARIANTS}`, notes: "" });
  assert(valid.copywriting.excerpt === "متوفرة بمقاسات من 36 - XS إلى 44 - XL.", "PC-7: مدى صحيح من خيارات التاجر لا يُمس");
}

main().then(done);

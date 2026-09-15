// المناسبة من بيانات التاجر وحدها (معيار ٦.٢)، معجم الحشو (٧.٥)، وخاتمة جدول المقاسات (٦.٧) — 2026-09-15.
// الحالات A/B/C مخرجات إنتاج حقيقية تُمرَّر على سلسلة ما بعد التوليد نفسها (cleanDescription → cleanPublishedFields → polishPage).
import { createRunner } from "../_helpers.mjs";
import { cleanDescription, cleanPublishedFields } from "../../functions/_lib/domain/copyParse.js";
import { polishPage } from "../../functions/_lib/domain/copyPage.js";
import { dropUnsourcedOccasions, stripUnsourcedOccasions } from "../../functions/_lib/domain/copyOccasion.js";
import { fixSizeChartClosing } from "../../functions/_lib/domain/copyClaims.js";
import { stripJudgments, unsourcedJudgment } from "../../functions/_lib/domain/copyJudgments.js";

const { assert, done } = createRunner("copy-occasion");

function pipeline({ name, sourceText, description, highlights = [], faqs = [], seo = {} }) {
  const p = { copywriting: { description, excerpt: "", whatsapp: "", highlights }, seo: { title: name, ...seo }, faqs, specsTable: [], tags: [] };
  p.copywriting.description = cleanDescription(p.copywriting.description, { sourceText, productName: name });
  cleanPublishedFields(p, { sourceText, name });
  return polishPage(p, { name, sourceText, notes: "", category: "فساتين" });
}

const A = "فستان ميدي أحمر وأسود بقصّة A وياقة عالية وأكمام طويلة، بدرابيه ونقشة كاروهات وقماش مطفي.\n\nيتوفر الفستان بالمقاسات من 36 إلى 44: XS وS وM وL وXL. راجعي جدول المقاسات قبل اختيار المقاس المناسب.";
const B = "فستان ميني وردي فاتح وأبيض بقصّة A وخصر مطاطي وياقة عالية وأكمام قصيرة، بكشكش ورباط وتخريم ونقشة مورّدة وقماش مطفي.\n\nيناسب الإطلالات النهارية، ويمكن تنسيقه مع حذاء بسيط لإطلالة خفيفة. يتوفر بالمقاسات 36 - XS، 38 - S، 40 - M، 42 - L، و44 - XL؛ راجعي جدول المقاسات قبل الاختيار.";
const B_OPEN = "فستان ميني وردي فاتح وأبيض بقصّة A وخصر مطاطي وياقة عالية وأكمام قصيرة، بكشكش ورباط وتخريم ونقشة مورّدة وقماش مطفي.";
const B_SIZES = "يتوفر بالمقاسات 36 - XS، 38 - S، 40 - M، 42 - L، و44 - XL.";

{
  const a = pipeline({ name: "فستان كاروهات", sourceText: "فستان كاروهات", description: A, highlights: ["قصة A بطول ميدي للإطلالات اليومية", "نقشة كاروهات باللونين الأحمر والأسود", "ياقة عالية وأكمام طويلة مع تفصيل درابيه"] });
  const d = a.copywriting.description;
  assert(d === "فستان ميدي أحمر وأسود بقصّة A وياقة عالية وأكمام طويلة، بدرابيه ونقشة كاروهات وقماش مطفي.\n\nيتوفر الفستان بالمقاسات من 36 إلى 44: XS وS وM وL وXL.", `CO-1: (A) إحالة جدول المقاسات غير المسندة تُحذف وتبقى المقاسات المتوفرة («${d}»)`);
  const hl = a.copywriting.highlights.join(" | ");
  assert(hl === "قصة A بطول ميدي | نقشة كاروهات باللونين الأحمر والأسود | ياقة عالية وأكمام طويلة مع تفصيل درابيه", `CO-2: (A) «للإطلالات اليومية» بنقطة تُحذف عبارتها وتبقى النقطة («${hl}»)`);
}
{
  const b = pipeline({ name: "فستان مورد", sourceText: "فستان مورد", description: B, highlights: ["قصّة واسعة تمنح التصميم حضوراً واضحاً"] });
  const d = b.copywriting.description;
  assert(d === `${B_OPEN}\n\n${B_SIZES}`, `CO-3: (B) «يناسب الإطلالات النهارية» غير المسندة وحشو «يمكن تنسيقه مع حذاء بسيط لإطلالة خفيفة» وإحالة الجدول تُحذف، والمقاسات تبقى («${d}»)`);
  assert(!b.copywriting.highlights.some((h) => /حضور/.test(h)), `CO-4: (B) نقطة «تمنح التصميم حضوراً واضحاً» لا تُنشر («${b.copywriting.highlights.join(" | ")}»)`);
}
{
  const c = pipeline({ name: "فستان مورد", sourceText: "فستان مورد مناسب للمناسبات النهارية", description: B, highlights: ["قصّة واسعة تمنح التصميم حضوراً واضحاً"] });
  const d = c.copywriting.description;
  assert(d === `${B_OPEN}\n\nيناسب الإطلالات النهارية. ${B_SIZES}`, `CO-5: (C) التاجر كتب «مناسب للمناسبات النهارية» ⇒ المناسبة تبقى، والحشو والجدول يُحذفان («${d}»)`);
}
{
  const src = "فستان أحمر";
  const cases = [
    ["فستان أحمر بياقة عالية لإطلالة نهارية.", "فستان أحمر بياقة عالية.", "CO-6: «لإطلالة نهارية» بآخر الجملة تُحذف وحدها"],
    ["فستان أحمر بأكمام طويلة، مناسب للدوام والسهرات.", "فستان أحمر بأكمام طويلة.", "CO-7: مقطع بعد «،» يبدأ بـ«مناسب» يُحذف كله بلا «،» معلّقة"],
    ["فستان أحمر بأكمام طويلة، ويُلبس في المناسبات الصيفية.", "فستان أحمر بأكمام طويلة.", "CO-8: «ويُلبس في المناسبات الصيفية» يُحذف بلا «و» معلّقة"],
    ["يتوفر بالمقاسات S وM وL.", "يتوفر بالمقاسات S وM وL.", "CO-9: جملة بلا مناسبة لا تُمس"],
    ["فستان أحمر بخط بارز وعمل يدوي.", "فستان أحمر بخط بارز وعمل يدوي.", "CO-10: «عمل يدوي» ليست مناسبة («العمل» بأل وحدها)"]
  ];
  for (const [input, expected, label] of cases) {
    const got = dropUnsourcedOccasions(input, src);
    assert(got === expected, `${label} («${got}»)`);
  }
  assert(dropUnsourcedOccasions("فستان سهرة أحمر للسهرات.", "فستان سهرة أحمر") === "فستان سهرة أحمر للسهرات.", "CO-11: جذر المناسبة بالاسم («فستان سهرة») ⇒ تبقى");
  const page = stripUnsourcedOccasions({ copywriting: { description: "فستان أحمر بياقة عالية.", highlights: ["أكمام طويلة حتى المعصم للاستخدام اليومي"] }, seo: { title: "فستان أحمر للسهرات", metaDescription: "فستان أحمر بياقة عالية وأكمام طويلة وقصّة A، مناسب للمناسبات والحفلات." }, faqs: [{ q: "هل يناسب السهرات؟", a: "نعم يناسب السهرات والمناسبات." }, { q: "ما طول الأكمام؟", a: "الأكمام طويلة حتى المعصم." }] }, { sourceText: src, name: "فستان أحمر" });
  assert(page.copywriting.highlights[0] === "أكمام طويلة حتى المعصم" && page.seo.title === "فستان أحمر" && page.seo.metaDescription === "فستان أحمر بياقة عالية وأكمام طويلة وقصّة A." && page.faqs.length === 1 && page.faqs[0].q === "ما طول الأكمام؟", `CO-12: كل حقل منشور — النقاط والعنوان والميتا، وسؤال المناسبة يُحذف بجوابه (${JSON.stringify(page)})`);
}
{
  assert(fixSizeChartClosing("فستان أحمر.\n\nراجعي جدول المقاسات قبل الطلب.", { name: "فستان أحمر", sourceText: "فستان أحمر؛ جدول المقاسات بالصور" }) === "فستان أحمر.\n\nراجعي جدول المقاسات قبل الطلب.", "CO-13: التاجر ذكر «جدول المقاسات» ⇒ الخاتمة تبقى");
  const sj = stripJudgments("تنورة سوداء بقصّة واسعة، تضيف لمسة لونية للتنسيق.", { sourceText: "تنورة", name: "تنورة" });
  assert(sj === "تنورة سوداء بقصّة واسعة.", `CO-14: «تضيف لمسة…» حشو يُحذف بمقطعه وتبقى الجملة («${sj}»)`);
  assert(unsourcedJudgment("فستان بتصميم بارز.", "") && unsourcedJudgment("قطعة لإطلالة متكاملة.", "") && unsourcedJudgment("يُنسّق مع إكسسوارات بسيطة.", "") && !unsourcedJudgment("حقيبة بشعار بارز على الواجهة.", ""), "CO-15: «بتصميم بارز» و«لإطلالة متكاملة» و«يُنسّق مع إكسسوارات بسيطة» أحكام؛ «شعار بارز» وصف يبقى");
}

done();

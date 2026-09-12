// أحكام بلا مصدر وحدها لا تستهلك نداء نموذج ثانياً (سجل الإنتاج 2026-09-12: كل إعادة لها انتهت تنظيفاً قسرياً).
import { createRunner } from "../_helpers.mjs";
import { generateProductCopy } from "../../functions/_lib/domain/copy.js";

const { assert, done } = createRunner("judgment-no-retry");

const page = (description, highlights) => JSON.stringify({
  seo: { title: "حقيبة جلد سوداء", seoTitle: "حقيبة جلد سوداء بحزام كتف", metaDescription: "حقيبة سوداء بحزام كتف قابل للتعديل وسحاب علوي وجيب داخلي، تُحمل على الكتف للدوام والطلعات اليومية.", focusKeyword: "حقيبة سوداء", lsiKeywords: ["حقيبة كتف"] },
  copywriting: { excerpt: "حقيبة سوداء بحزام كتف قابل للتعديل وسحاب علوي وجيب داخلي.", description, highlights, whatsapp: "حقيبة سوداء بحزام كتف قابل للتعديل وسحاب علوي." },
  specsTable: [{ key: "اللون", value: "أسود" }],
  faqs: [{ q: "هل الحزام قابل للتعديل؟", a: "نعم، حزام الكتف قابل للتعديل." }],
  imageAlt: "حقيبة جلد سوداء", tags: ["حقيبة سوداء"]
});

async function main() {
  {
    let textCalls = 0;
    const AI = { run: async () => { textCalls += 1; return { response: page("حقيبة جلد سوداء أنيقة بحزام كتف قابل للتعديل وسحاب علوي وجيب داخلي، تُحمل على الكتف للدوام والطلعات اليومية وتتسع للأغراض الأساسية مثل الهاتف والمحفظة والمفاتيح.\n\nتُنسّق مع ملابس الدوام أو إطلالة كاجوال بسيطة.", ["حزام كتف قابل للتعديل بطول مناسب", "تصميم فاخر وجذاب"]) }; } };
    const out = await generateProductCopy({ env: { AI }, merchantId: "m_1", name: "حقيبة جلد سوداء", price: "", tone: "white", category: "", features: "", existingDescription: "", imageUrl: "", keywordsExtra: [] });
    const all = JSON.stringify(out);
    assert(textCalls === 1, `JNR-1: أحكام بلا مصدر وحدها ⇒ نداء نصي واحد لا إعادة (نداءات: ${textCalls})`);
    assert(!/أنيق|فاخر|جذاب/.test(all), "JNR-2: الأحكام تُحذف حتمياً من كل الحقول بلا إعادة");
    assert(out.copywriting.highlights.includes("حزام كتف قابل للتعديل بطول مناسب"), "JNR-4: «حزام كتف» بنقاط حقيبة جزء منها لا «قطعة أخرى» تُحذف");
  }
  {
    let textCalls = 0;
    const AI = { run: async () => { textCalls += 1; return { response: page("هذه حقيبة جلد سوداء أنيقة بحزام كتف قابل للتعديل وسحاب علوي وجيب داخلي، تُحمل على الكتف للدوام والطلعات اليومية وتتسع للأغراض الأساسية مثل الهاتف والمحفظة والمفاتيح.", ["حزام كتف قابل للتعديل بطول مناسب"]) }; } };
    await generateProductCopy({ env: { AI }, merchantId: "m_1", name: "حقيبة جلد سوداء", price: "", tone: "white", category: "", features: "", existingDescription: "", imageUrl: "", keywordsExtra: [] });
    assert(textCalls === 2, `JNR-3: عيب لا يُنظَّف حتمياً (افتتاحية «هذه») مع الحكم ⇒ الإعادة باقية (نداءات: ${textCalls})`);
  }
}

main().then(done);

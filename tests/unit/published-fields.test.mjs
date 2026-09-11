// حراس الحقول المنشورة (2026-09-11) — حاجب تقديم سلة.
//
// ما يُنشر على صفحة المنتج: فقرات الوصف + النقاط + الأسئلة الشائعة + العنوان والميتا.
// المخرجات الحقيقية الأربعة (review_queue، كلها رفضها التاجر) اختلقت في الأسئلة الشائعة
// مدة شحن وطرق دفع وسياسة إرجاع، وكانت النقاط «مريح · انيق · طويل». الحارس السابق
// لم يكن يرى هذه الحقول. النصوص المعيبة أدناه منقولة من تلك المخرجات حرفياً.
import { createRunner } from "../_helpers.mjs";
import { publishedFieldIssues, cleanPublishedFields } from "../../functions/_lib/domain/copyParse.js";
import { generateProductCopy } from "../../functions/_lib/domain/copy.js";
import { buildSeoSystem } from "../../functions/_lib/ai/prompts/seo.js";
import { buildSallaProductFields } from "../../functions/_lib/domain/sallaProductPayload.js";

const { assert, done } = createRunner("published-fields");

const DESC = "فستان وردي فاتح بقصّة واسعة وطول متوسط، بأكمام طويلة وكسرات ناعمة في الجزء العلوي والتنورة. الياقة مرتفعة ومستديرة، والتصميم يناسب المناسبات الصيفية والنهارية مع صندل مسطح أو حذاء بكعب منخفض. راجعي جدول المقاسات قبل الطلب لمطابقة الطول.";
const GOOD_FAQ = { q: "ما نوع قصّة الفستان؟", a: "قصّة واسعة بطول متوسط مع كسرات في الجزء العلوي والتنورة." };
const codes = (p, src) => publishedFieldIssues(p, { sourceText: src }).map((i) => i.code);
const payload = (over = {}) => ({
  seo: { title: "فستان وردي فاتح بقصّة واسعة", seoTitle: "فستان وردي فاتح بأكمام طويلة", metaDescription: "فستان وردي فاتح بقصّة واسعة وطول متوسط وأكمام طويلة مع كسرات ناعمة، يناسب المناسبات الصيفية والنهارية. راجعي جدول المقاسات قبل الطلب." },
  copywriting: { description: DESC, excerpt: "فستان وردي فاتح بقصّة واسعة وأكمام طويلة.", whatsapp: "فستان وردي فاتح بقصّة واسعة.", highlights: ["قصّة واسعة بطول متوسط", "أكمام طويلة مع كسرات ناعمة"] },
  faqs: [GOOD_FAQ],
  ...over
});

function mockAi(responses) {
  const seen = { calls: 0, systems: [] };
  let i = 0;
  return { seen, AI: { run: async (_m, opts) => { seen.calls += 1; seen.systems.push(opts?.messages?.[0]?.content || ""); const out = responses[Math.min(i, responses.length - 1)]; i += 1; return { response: out }; } } };
}

async function main() {
  // ── الكشف على النصوص الحقيقية ─────────────────────────────────────────
  {
    assert(codes(payload(), "") .length === 0, "PF-1: مخرج سليم بكل حقوله لا يُنذر");
    const shipping = payload({ faqs: [GOOD_FAQ, { q: "ما هي طريقة الشحن؟", a: "تتم شحن الطلبات خلال 3-5 أيام عمل." }] });
    assert(codes(shipping, "").includes("FIELD_STORE_POLICY"), "PF-2: «تتم شحن الطلبات خلال 3-5 أيام عمل» بسؤال شائع تُمسك — مدة شحن مختلقة");
    const payment = payload({ faqs: [{ q: "ما هي طريقة الدفع؟", a: "يمكنك الدفع عبر وسائل دفع متعددة، بما في ذلك بطاقات الائتمان والتحويل البنكي." }] });
    assert(codes(payment, "").includes("FIELD_STORE_POLICY"), "PF-3: طرق دفع مختلقة بسؤال شائع تُمسك");
    const price = payload({ faqs: [{ q: "ما هو سعر الفستان؟", a: "سعر الفستان 114 ريال سعودي." }] });
    assert(codes(price, "").includes("FIELD_PRICE_IN_PROSE"), "PF-4: السعر بسؤال شائع يُمسك");
    const thin = payload({ copywriting: { ...payload().copywriting, highlights: ["مريح", "انيق", "طويل"] } });
    const tc = codes(thin, "");
    assert(tc.includes("FIELD_THIN_HIGHLIGHT") && tc.includes("FIELD_UNSOURCED_JUDGMENT"), "PF-5: نقاط «مريح · انيق · طويل» تُمسك كنقاط فارغة وأحكام بلا مصدر");
    const meta = payload({ seo: { ...payload().seo, metaDescription: "فستان نسائي أسود، قصة ميدي، بلا أكمام، وياقة دائرية. متوفر الآن بسعر 114 ريال سعودي." } });
    assert(codes(meta, "").includes("FIELD_PRICE_IN_PROSE"), "PF-6: السعر بوصف الميتا يُمسك");
    const leak = payload({ copywriting: { ...payload().copywriting, description: DESC + " الياقة مرتفعة و لا يوجد أزرار أو حزام مرئي." } });
    assert(codes(leak, "").includes("FIELD_MECHANISM_LEAK"), "PF-7: «لا يوجد حزام مرئي» بالوصف يُمسك ككشف آلية");
    const guess = payload({ copywriting: { ...payload().copywriting, description: DESC + " يبدو أن الفستان مصنوع من نوعين من القماش." } });
    assert(codes(guess, "").includes("FIELD_MECHANISM_LEAK"), "PF-8: «يبدو أن الفستان مصنوع من…» يُمسك");
  }

  // ── لا إنذار كاذب ────────────────────────────────────────────────────────
  {
    const charger = payload({ copywriting: { ...payload().copywriting, highlights: ["يدعم الشحن السريع عبر منفذ USB-C", "كابل بطول متر ونصف"] } });
    assert(!codes(charger, "").includes("FIELD_STORE_POLICY"), "PF-9: «يدعم الشحن السريع» مواصفة شاحن لا سياسة شحن");
    const warranty = payload({ copywriting: { ...payload().copywriting, highlights: ["ضمان سنتين من الوكيل على الجهاز"] } });
    assert(!codes(warranty, "سماعة لاسلكية ضمان سنتين من الوكيل").includes("FIELD_STORE_POLICY"), "PF-10: ضمان ذكره التاجر بمزاياه مسموح");
    assert(codes(warranty, "سماعة لاسلكية").includes("FIELD_STORE_POLICY"), "PF-11: نفس الضمان بلا ذكر من التاجر يُمسك");
    const comfy = payload({ copywriting: { ...payload().copywriting, highlights: ["قماش مريح للاستخدام اليومي الطويل"] } });
    assert(!codes(comfy, "عباية قماش مريح").includes("FIELD_UNSOURCED_JUDGMENT"), "PF-12: «مريح» حين ذكره التاجر مسموح");
  }

  // ── التنظيف: حذف فقط ─────────────────────────────────────────────────────
  {
    const bad = payload({
      copywriting: { ...payload().copywriting, highlights: ["مريح", "قصّة واسعة بطول متوسط"] },
      faqs: [GOOD_FAQ, { q: "ما هي طريقة الشحن؟", a: "تتم شحن الطلبات خلال 3-5 أيام عمل." }, { q: "ما هو سعر الفستان؟", a: "سعر الفستان 114 ريال سعودي." }],
      seo: { title: "فستان وردي {الخامة}", seoTitle: "فستان وردي فاتح", metaDescription: "فستان وردي متوفر الآن بسعر 83 ريال." }
    });
    cleanPublishedFields(bad, { sourceText: "", name: "فستان وردي فاتح" });
    assert(bad.faqs.length === 1 && bad.faqs[0] === GOOD_FAQ, "PF-13: السؤالان المعيبان يُحذفان والسليم يبقى كما هو");
    assert(bad.copywriting.highlights.length === 1 && bad.copywriting.highlights[0] === "قصّة واسعة بطول متوسط", "PF-14: النقطة الفارغة تُحذف والمفيدة تبقى");
    assert(bad.seo.title === "فستان وردي فاتح", "PF-15: عنوان بعنصر نائب يعود لاسم المنتج");
    assert(!/ريال|سعر/.test(bad.seo.metaDescription) && bad.seo.metaDescription.length > 0, "PF-16: ميتا بسعر تُعاد من النبذة بلا سعر");
    const html = buildSallaProductFields({ description: bad.copywriting.description, excerpt: bad.copywriting.excerpt, highlights: bad.copywriting.highlights, faqs: bad.faqs, seo: bad.seo }).fields.description;
    assert(!/شحن|ريال|\{/.test(html), "PF-17: HTML المنشور لسلة بعد التنظيف بلا شحن ولا سعر ولا معقوف");
  }

  // ── التكامل: إعادة محاولة ثم تنظيف ───────────────────────────────────────
  {
    const badJson = JSON.stringify(payload({ faqs: [{ q: "ما هي طريقة الشحن؟", a: "تتم شحن الطلبات خلال 3-5 أيام عمل." }], copywriting: { ...payload().copywriting, highlights: ["مريح", "انيق"] } }));
    const ai = mockAi([badJson]);
    const out = await generateProductCopy({ env: { ...ai }, merchantId: "m_1", name: "فستان وردي فاتح", price: "", tone: "white", category: "", features: "", existingDescription: "", imageUrl: "", keywordsExtra: [] });
    assert(ai.seen.calls === 2 && /سياسة متجر/.test(ai.seen.systems[1]) && /نقطة من كلمة/.test(ai.seen.systems[1]), "PF-18: حقول منشورة معيبة ⇒ إعادة محاولة تسمّي العيوب");
    assert(out.faqs.length === 0 && out.copywriting.highlights.length === 0, "PF-19: عند الإصرار تُحذف الأسئلة والنقاط المعيبة — لا تصل صفحة المتجر");
    const ai2 = mockAi([JSON.stringify(payload())]);
    const out2 = await generateProductCopy({ env: { ...ai2 }, merchantId: "m_1", name: "فستان وردي فاتح", price: "", tone: "white", category: "", features: "", existingDescription: "", imageUrl: "", keywordsExtra: [] });
    assert(ai2.seen.calls === 1 && out2.faqs.length === 1 && out2.copywriting.highlights.length === 2, "PF-20: مخرج سليم ⇒ نداء واحد وكل الحقول تبقى");
  }

  // ── البرومبت ─────────────────────────────────────────────────────────────
  {
    const sys = buildSeoSystem({ recent: [], keywords: [], existingDescription: "", visionNotes: "", visionLanguage: "ar", variants: [], styleExamples: [], profileBlock: "", taxonomyBlock: "" });
    assert(/ممنوع أي سؤال شائع أو نقطة عن الشحن أو التوصيل أو الإرجاع/.test(sys) && /ثلاث كلمات فأكثر/.test(sys), "PF-21: البرومبت يمنع أسئلة السياسة والنقاط الفارغة صراحة");
  }
}

main().then(done);

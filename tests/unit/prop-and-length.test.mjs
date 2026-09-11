// قطع العارضة وقِصَر الوصف (2026-09-11) — مخرج حقيقي بالنسخة المنشورة على متجر المراجعة.
//
// منتج «بلوزة» بصورة عارضة تلبس تنورة بطبقات زرقاء. خرج الوصف:
// «بلوزة نسائية بيضاء اللون، قصيرة الأكمام، وياقة دائرية. التنورة مصنوعة من طبقات
// لونية: أبيض وأزرق فاتح وأزرق غامق. هذه البلوزة مثالية للمناسبات الصيفية والنهارية.»
// ثلاثة عيوب مرّت من كل الحراس: وصف قطعة ليست المنتج، ٢٧ كلمة رغم الصورة (التنظيف
// يحذف ولا يطيل)، و«مثالية» حكم بلا مصدر خارج قائمة الأحكام. وفات الدانتيل الظاهر.
import { createRunner } from "../_helpers.mjs";
import { descriptionQualityIssues, publishedFieldIssues, cleanDescription } from "../../functions/_lib/domain/copyParse.js";
import { generateProductCopy } from "../../functions/_lib/domain/copy.js";
import { buildSeoSystem } from "../../functions/_lib/ai/prompts/seo.js";

const { assert, done } = createRunner("prop-and-length");

const REAL_BLOUSE = "بلوزة نسائية بيضاء اللون، قصيرة الأكمام، وياقة دائرية. التنورة مصنوعة من طبقات لونية: أبيض وأزرق فاتح وأزرق غامق. هذه البلوزة مثالية للمناسبات الصيفية والنهارية.";
const LONG_GOOD = "بلوزة بيضاء بأكمام قصيرة وياقة دائرية واسعة تتجمع بكسرات خفيفة عند خط الصدر، مع تفصيل دانتيل ظاهر على الكتف والكم. قصّتها مستقيمة تنزل حتى الخصر، فتدخل تحت التنورة أو تُلبس فوقها بحرية.\n\nتُنسَّق مع تنورة بطبقات زرقاء أو بنطال بيج واسع للإطلالات الصيفية والنهارية، وتناسب الدوام والزيارات العائلية.\n\nراجعي جدول المقاسات قبل الطلب لمطابقة عرض الكتفين وطول القطعة.";
const VISION_NOTES = "بلوزة بيضاء بأكمام قصيرة وياقة دائرية مع كسرات عند الصدر، وتفصيل دانتيل على الكتف والكم. العارضة تلبس تنورة بطبقات بيضاء وزرقاء. اليد اليمنى في الجيب.";

const codes = (arr) => arr.map((i) => i.code);
const copyJson = (description) => JSON.stringify({
  seo: { title: "بلوزة بيضاء بأكمام قصيرة", seoTitle: "بلوزة بيضاء بأكمام قصيرة وياقة دائرية", metaDescription: "بلوزة بيضاء بأكمام قصيرة وياقة دائرية مع كسرات عند الصدر، تُنسَّق مع تنورة أو بنطال للإطلالات الصيفية. راجعي جدول المقاسات قبل الطلب." },
  copywriting: { description, excerpt: "بلوزة بيضاء بأكمام قصيرة وياقة دائرية.", whatsapp: "بلوزة بيضاء بأكمام قصيرة.", highlights: [] },
  specsTable: [], faqs: [], tags: []
});

/** AI وهمي: نداء الرؤية (محتوى رسالة مصفوفة) يرجّع الملاحظات؛ نداءات النص تتبع التسلسل. */
function mockAi(textResponses) {
  const seen = { vision: 0, text: 0, systems: [] };
  let i = 0;
  return {
    seen,
    AI: {
      run: async (_model, input) => {
        if (Array.isArray(input?.messages?.[0]?.content)) { seen.vision += 1; return { response: VISION_NOTES }; }
        seen.text += 1;
        seen.systems.push(input?.messages?.[0]?.content || "");
        const out = textResponses[Math.min(i, textResponses.length - 1)];
        i += 1;
        return { response: out };
      }
    }
  };
}

async function withImageFetch(fn) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/jpeg" } });
  try { return await fn(); } finally { globalThis.fetch = realFetch; }
}

const args = (env, over = {}) => ({ env, merchantId: "m_1", name: "بلوزة", price: "", tone: "white", category: "", features: "", existingDescription: "", imageUrl: "", keywordsExtra: [], ...over });

async function main() {
  // ── الكشف على المخرج الحقيقي ─────────────────────────────────────────────
  {
    const c = codes(descriptionQualityIssues({ description: REAL_BLOUSE }, { hasVision: true, sourceText: "", productName: "بلوزة" }));
    assert(c.includes("PROP_ITEM"), "PL-1: «التنورة مصنوعة من…» بوصف بلوزة تُمسك كقطعة عارضة");
    assert(c.includes("TOO_SHORT"), "PL-2: ٢٧ كلمة رغم الصورة تُمسك كقصيرة");
    assert(codes(publishedFieldIssues({ copywriting: { description: REAL_BLOUSE } }, { sourceText: "" })).includes("FIELD_UNSOURCED_JUDGMENT"), "PL-3: «مثالية» حكم بلا مصدر يُمسك");
  }

  // ── لا إنذار كاذب ────────────────────────────────────────────────────────
  {
    assert(descriptionQualityIssues({ description: LONG_GOOD }, { hasVision: true, sourceText: "", productName: "بلوزة" }).length === 0, "PL-4: «تُنسَّق مع تنورة…» تنسيق مسموح، ووصف ٦٠ كلمة يمر");
    assert(publishedFieldIssues({ copywriting: { description: LONG_GOOD } }, { sourceText: "", productName: "بلوزة" }).length === 0, "PL-5: الوصف السليم بلا عيوب حقول منشورة");
    assert(!codes(descriptionQualityIssues({ description: "مسبحة بخرز عسلي. الحقيبة المرفقة سوداء." }, { productName: "مسبحة" })).includes("PROP_ITEM"), "PL-6: نوع منتج خارج القائمة ⇒ لا فحص (محافظ عمداً)");
    assert(!codes(descriptionQualityIssues({ description: "فستان ماكسي أسود. الفساتين بهذي القصّة تتسع عند الأسفل." }, { productName: "فستان" })).includes("PROP_ITEM"), "PL-7: جمع نفس النوع («الفساتين») ليس قطعة أخرى");
    assert(codes(descriptionQualityIssues({ description: "بلوزة بيضاء. والتنورة بطبقات زرقاء." }, { productName: "بلوزة" })).includes("PROP_ITEM"), "PL-8: «والتنورة…» بواو العطف تُمسك أيضاً");
    assert(!codes(descriptionQualityIssues({ description: "وشاح بنقشة مربعات صغيرة. وشاح بطول يسمح بلفّه مرتين." }, { productName: "وشاح" })).includes("PROP_ITEM"), "PL-9: «وشاح» منتجاً لا تُقصّ واوه الأصلية فيُحسب قطعة أخرى");
  }

  // ── التنظيف: حذف فقط ─────────────────────────────────────────────────────
  {
    const cleaned = cleanDescription(REAL_BLOUSE, { sourceText: "", productName: "بلوزة" });
    assert(cleaned === "بلوزة نسائية بيضاء اللون، قصيرة الأكمام، وياقة دائرية.", `PL-10: جملة التنورة وجملة «مثالية» تُحذفان والصحيحة تبقى («${cleaned}»)`);

    // مخرج الكاتب المركّز الحقيقي (2026-09-11 22:49 UTC): الحكم داخل جملة صحيحة.
    const realFocused = "بلوزة بيضاء بتصميم أنيق وياقة دائرية وأكمام قصيرة. القصّة مستقيمة تعطيها لمسة من الأناقة، والطول مناسب لمن يفضلون الإطلالات الكلاسيكية.";
    assert(publishedFieldIssues({ copywriting: { description: "القصّة مستقيمة تعطيها لمسة من الأناقة، والطول مناسب." } }, { sourceText: "" }).some((i) => i.code === "FIELD_UNSOURCED_JUDGMENT"), "PL-22: «لمسة من الأناقة» حكم بلا مصدر يُمسك (كان يفلت)");
    const kept = cleanDescription(realFocused, { sourceText: "", productName: "بلوزة" });
    assert(/^بلوزة بيضاء/.test(kept) && /وياقة دائرية/.test(kept) && /القصّة مستقيمة/.test(kept) && !/[أا]ناق|أنيق/.test(kept), `PL-23: الحكم يُزال من الجملة وتبقى الجملتان وافتتاحية اسم المنتج («${kept}»)`);
    assert(cleanDescription("بلوزة بيضاء بتصميم أنيق وياقة دائرية.", { sourceText: "بلوزة أنيقة للدوام", productName: "بلوزة" }) === "بلوزة بيضاء بتصميم أنيق وياقة دائرية.", "PL-24: «أنيق» ذكرها التاجر ⇒ لا تُمس");
  }

  // ── البرومبت ─────────────────────────────────────────────────────────────
  {
    const base = { recent: [], keywords: [], existingDescription: "", visionNotes: VISION_NOTES, visionLanguage: "ar", variants: [], styleExamples: [], profileBlock: "", taxonomyBlock: "" };
    assert(/اكتبي عن «بلوزة» وحده/.test(buildSeoSystem({ ...base, productName: "بلوزة" })), "PL-11: البرومبت يسمّي المنتج ويجعل قطع العارضة تنسيقاً فقط");
    assert(!/تلبسها العارضة/.test(buildSeoSystem(base)), "PL-12: بلا اسم منتج لا تُحقن القاعدة (سلوك سابق محفوظ)");
    const { VISION_PROMPT } = await import("../../functions/_lib/ai/prompts/seo.js");
    assert(/لا وضعية العارضة ولا يديها/.test(VISION_PROMPT) && /أي دانتيل أو تطريز/.test(VISION_PROMPT), "PL-21: توجيه الرؤية يحصر الوصف بالقطعة المعروضة ويفحص الياقة والأكمام والتفاصيل بالترتيب");
    assert(/«الياقة: …»/.test(VISION_PROMPT) && /«التفاصيل: …»/.test(VISION_PROMPT) && /ولا يتناقض سطران/.test(VISION_PROMPT) && !/المرئية: …/.test(VISION_PROMPT), "PL-25: ملاحظات الرؤية منظّمة بسطر لكل جانب (ملاحظات حقيقية سابقة تناقضت: «قصيرة وبدون أكمام ظاهرة»)");
  }

  // ── التكامل: إعادة الطول مع صورة ─────────────────────────────────────────
  {
    const ai = mockAi([copyJson(REAL_BLOUSE), copyJson(REAL_BLOUSE), LONG_GOOD]);
    const out = await withImageFetch(() => generateProductCopy(args({ ...ai }, { imageUrl: "https://cdn.example.com/blouse.jpg" })));
    assert(ai.seen.vision >= 1 && ai.seen.text === 3, `PL-13: قصير بعد الإعادة العامة ⇒ كاتب وصف مركّز ثالث (نصية: ${ai.seen.text})`);
    assert(/اكتبي وصف «بلوزة» فقط/.test(ai.seen.systems[2]) && !/specsTable/.test(ai.seen.systems[2]) && ai.seen.systems[2].length < 2000, "PL-14: الكاتب المركّز برومبت قصير مستقل لحقل الوصف وحده، بلا مخطط JSON");
    assert(out.copywriting.description === LONG_GOOD, "PL-15: النسخة الطويلة السليمة تُعتمد");
    assert(!/العارضة تلبس/.test(ai.seen.systems[0]) && /تفصيل دانتيل على الكتف/.test(ai.seen.systems[0]), "PL-19: جملة العارضة تُحذف من ملاحظات الصورة قبل الكاتب، وجمل المنتج تبقى");
    assert(!/اليد اليمنى/.test(ai.seen.systems[0]) && !/اليد اليمنى/.test(ai.seen.systems[2]), "PL-20: وضعية العارضة («اليد اليمنى في الجيب») تُحذف من الملاحظات بكل النداءات");
  }
  {
    const ai = mockAi([copyJson(REAL_BLOUSE)]);
    const out = await withImageFetch(() => generateProductCopy(args({ ...ai }, { imageUrl: "https://cdn.example.com/blouse.jpg" })));
    assert(ai.seen.text === 3, "PL-16: الإصرار ⇒ ثلاث محاولات نصية فقط لا حلقة (والكاتب المركّز إن أعاد JSON يُقرأ وصفه ويُرفض لقِصَره)");
    assert(out.copywriting.description === "بلوزة نسائية بيضاء اللون، قصيرة الأكمام، وياقة دائرية." && !/تنورة|مثالية/.test(out.copywriting.description), "PL-17: عند الإصرار لا تصل التنورة ولا «مثالية» صفحة المتجر");
  }
  {
    const ai = mockAi([copyJson(REAL_BLOUSE)]);
    await generateProductCopy(args({ ...ai }));
    assert(ai.seen.vision === 0 && ai.seen.text === 2, "PL-18: بلا صورة لا محاولة طول (قاعدة «أقصر وأصدق» باقية)");
  }
}

main().then(done);

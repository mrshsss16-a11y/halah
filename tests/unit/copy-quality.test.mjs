// بوابة جودة الوصف (2026-09-11) — من وصف حقيقي أنتجه النموذج بمتجر المراجعة:
// «هذي تنورة نسائية طويلة، لونها أسود جميل. القصة طويلة ومنتفخة قليلاً عند
// الأسفل، تعطيك إطلالة أنيقة وستثنينية. مناسبة للسهرات والمناسبات الخاصة.
// السعر: 83 ريال.»
// ثلاثة عيوب مرّت من تحليل JSON: افتتاحية إشارية، سعر داخل النثر، ووصف قصير
// عامّ رغم توفّر ملاحظات صورة. الحارس هنا حتمي: يُعاد التوليد مرة بتعليمة
// تسمّي العيب، ثم يُنظَّف النص لو أصرّ النموذج — ولا يُنشر «هذي…» أبداً.
import { createRunner } from "../_helpers.mjs";
import { descriptionQualityIssues, cleanDescription } from "../../functions/_lib/domain/copyParse.js";
import { buildSeoSystem } from "../../functions/_lib/ai/prompts/seo.js";
import { generateProductCopy } from "../../functions/_lib/domain/copy.js";
import { askWorkersAI } from "../../functions/_lib/ai/gateway.js";

const { assert, done } = createRunner("copy-quality");

const REAL_BAD = "هذي تنورة نسائية طويلة، لونها أسود جميل. القصة طويلة ومنتفخة قليلاً عند الأسفل، تعطيك إطلالة أنيقة وستثنينية. مناسبة للسهرات والمناسبات الخاصة. السعر: 83 ريال.";
// الملابس النسائية تُنشر بجملة جدول المقاسات إن غابت (copyPhrases.withSizeChartLine، 2026-09-12).
const withChart = (d) => `${d}\n\nراجعي جدول المقاسات قبل الطلب لاختيار المقاس المناسب.`;
const GOOD_DESC = "تنورة سوداء طويلة بقصّة كلوش تتّسع تدريجياً نحو الأسفل، بخصر مرتفع يبرز القوام ويعطي انسدالاً هادئاً مع كل خطوة. اللون الأسود يجعلها قطعة أساسية تُنسَّق مع بلوزة فاتحة للنهار أو توب لامع للسهرات. متوفرة بمقاسات من XS إلى XL، وتناسب المناسبات المسائية والإطلالات الرسمية على حدّ سواء بلا مجهود.";

const copyJson = (description, extra = {}) => JSON.stringify({
  seo: { title: "تنورة", metaDescription: "م".repeat(130), slug: "تنورة" },
  copywriting: { description, excerpt: "نبذة", whatsapp: "واتساب", ...extra },
  specsTable: [], faqs: [], tags: []
});

/** AI وهمي يسجّل النظام ورسالة المستخدم وخيارات النداء لكل محاولة. */
function mockAi(responses) {
  const seen = { calls: 0, systems: [], users: [], opts: [] };
  let i = 0;
  return {
    seen,
    AI: {
      run: async (_model, opts) => {
        seen.calls += 1;
        seen.systems.push(opts?.messages?.[0]?.content || "");
        seen.users.push(opts?.messages?.[1]?.content || "");
        seen.opts.push(opts);
        const out = responses[Math.min(i, responses.length - 1)];
        i += 1;
        return { response: out };
      }
    }
  };
}

async function main() {
  // ── الكشف الحتمي ─────────────────────────────────────────────────────────
  {
    const codes = descriptionQualityIssues({ description: REAL_BAD, excerpt: "", whatsapp: "" }, { hasVision: true }).map((i) => i.code);
    assert(codes.includes("BAD_OPENER"), "CQ-1: «هذي تنورة…» تُمسك كافتتاحية إشارية");
    assert(codes.includes("PRICE_IN_PROSE"), "CQ-2: «السعر: 83 ريال» داخل الوصف يُمسك");
    assert(codes.includes("BAD_OPENER") && codes.includes("PRICE_IN_PROSE"), `CQ-3: «هذي تنورة…» (${REAL_BAD.split(/\s+/).length} كلمة) يُمسك بالافتتاحية والسعر مهما كان طوله`);
    assert(descriptionQualityIssues({ description: "تنورة سوداء طويلة بقصّة كلوش وخصر مرتفع.", excerpt: "", whatsapp: "" }, { hasVision: true }).some((i) => i.code === "TOO_SHORT"), "CQ-3b: وصف أقصر من ٣٥ كلمة رغم الصورة يُمسك كقصير");
    assert(descriptionQualityIssues({ description: GOOD_DESC, excerpt: "نبذة", whatsapp: "واتساب" }, { hasVision: true }).length === 0, "CQ-4: وصف سليم يمرّ بلا إنذار كاذب");
    assert(descriptionQualityIssues({ description: "وصف قصير صادق.", excerpt: "", whatsapp: "" }, { hasVision: false }).length === 0, "CQ-5: بلا صورة لا يُعاقَب القِصَر — قاعدة «أقصر وأصدق» باقية");
    for (const opener of ["هذه عباية", "هذا فستان", "منتجنا المميز", "إليك تنورة", "نقدم لك"]) {
      assert(descriptionQualityIssues({ description: opener + " …" }).some((i) => i.code === "BAD_OPENER"), `CQ-6: افتتاحية «${opener.split(" ")[0]}» تُمسك`);
    }
    assert(descriptionQualityIssues({ description: "الوصف سليم", excerpt: "", whatsapp: "بس ٨٣ ريال" }).some((i) => i.code === "PRICE_IN_PROSE"), "CQ-7: السعر بنسخة الواتساب يُمسك أيضاً (أرقام عربية)");
    assert(!descriptionQualityIssues({ description: "تنورة بطول 95 سم بقصّة كلوش وخصر مرتفع مع انسدال ناعم." }).some((i) => i.code === "PRICE_IN_PROSE"), "CQ-8: رقم قياس (سم) ليس سعراً — لا إنذار كاذب");
  }

  // ── ادعاءات محظورة (مكتبة الأوصاف السعودية — نواهي N001/N003/N010، مقومات C005) ──
  {
    const bad = (t) => descriptionQualityIssues({ description: t, excerpt: "", whatsapp: "" }).some((i) => i.code === "PROHIBITED_CLAIM");
    assert(bad("تنورة سوداء طويلة. بعد تحليل الصورة نجد أنها بقصّة كلوش."), "CQ-28: «بعد تحليل الصورة» ادعاء محظور — العميل لا يهمّه كيف كُتب الوصف");
    assert(bad("فستان ماكسي أسود يناسب كل الأجسام ويخفي العيوب."), "CQ-29: حكم على الجسد («يناسب كل الأجسام») يُمسك");
    assert(bad("سماعة لاسلكية سوداء، منتج أصلي 100%."), "CQ-30: «منتج أصلي» بلا شهادة يُمسك");
    assert(bad("عباية كلوش سوداء. الكمية محدودة سارعي بالطلب!"), "CQ-31: ندرة مصطنعة تُمسك");
    assert(descriptionQualityIssues({ description: "الوصف سليم", excerpt: "", whatsapp: "أصلي 100% ومضمون" }).some((i) => i.code === "PROHIBITED_CLAIM"), "CQ-32: الادعاء بنسخة الواتساب يُمسك أيضاً");
    assert(!bad(GOOD_DESC) && !bad("تنورة بقصّة كلوش تناسب الإطلالات المسائية. راجعي جدول المقاسات قبل الطلب."), "CQ-33: «تناسب الإطلالات» ودعوة جدول المقاسات ليستا ادعاءً — لا إنذار كاذب");
    const cleaned = cleanDescription("تنورة سوداء طويلة بقصّة كلوش. يناسب كل الأجسام ويخفي العيوب. مناسبة للسهرات.");
    assert(cleaned === "تنورة سوداء طويلة بقصّة كلوش. مناسبة للسهرات.", `CQ-34: جملة الادعاء تُحذف كاملة والباقي يبقى («${cleaned}»)`);
    const sys = buildSeoSystem({ recent: [], keywords: [], existingDescription: "", visionNotes: "", visionLanguage: "ar", variants: [], styleExamples: [], profileBlock: "", taxonomyBlock: "" });
    assert(/ادعاءات محظورة/.test(sys) && /يناسب كل الأجسام/.test(sys) && /الكمية محدودة/.test(sys), "CQ-35: قاعدة الادعاءات المحظورة بالبرومبت الرئيسي");
    const { VISION_PROMPT } = await import("../../functions/_lib/ai/prompts/seo.js");
    assert(/جسم العارضة/.test(VISION_PROMPT) && /أداة تصوير لا جزءاً من المنتج/.test(VISION_PROMPT), "CQ-36: توجيه الرؤية يمنع المقاس من العارضة وعدّ الإكسسوار التصويري كمرفق (I006/I007)");
  }

  // ── قاعدة معرفة الدعم السعودية: الممنوعات F001–F009/F015 + خامات بلا مصدر ──
  {
    const claim = (t) => descriptionQualityIssues({ description: t, excerpt: "", whatsapp: "" }).some((i) => i.code === "PROHIBITED_CLAIM");
    assert(claim("عباية كلوش سوداء. آخر قطعة بالمتجر!") && claim("سماعة لاسلكية بأرخص سعر.") && claim("لا تفوّتي الفرصة واطلبيها.") && claim("نضمن لك إطلالة مختلفة.") && claim("فستان يوصل بكرة لباب بيتك."), "CQ-37: ندرة/مقارنة سوق/ضغط/ضمان/موعد توصيل من «الممنوعات» تُمسك");
    const mat = (t, src) => descriptionQualityIssues({ description: t, excerpt: "", whatsapp: "" }, { sourceText: src }).some((i) => i.code === "UNSOURCED_MATERIAL");
    assert(mat("خاتم ذهب بفص دائري لامع.", "خاتم نسائي") && mat("قلادة مرصعة بالألماس.", "قلادة") && mat("شال حرير طبيعي بلون زيتي.", "شال زيتي"), "CQ-38: ذهب/ألماس/حرير بلا ذكر ببيانات التاجر يُمسك (F005/F006)");
    assert(!mat("خاتم ذهب عيار ٢١ بفص دائري.", "خاتم ذهب عيار ٢١") && !mat("قلادة مرصعة بالألماس.", "قلادة ألماس طبيعي"), "CQ-39: الخامة الواردة ببيانات التاجر مسموحة — المصدر يثبتها");
    assert(!mat("خاتم بلون ذهبي ولمعة فضية وملمس حريري.", "خاتم"), "CQ-40: «ذهبي/فضية/حريري» ألوان وملمس لا مواد — لا إنذار كاذب");
    assert(!mat("خاتم ذهب.", undefined), "CQ-41: بلا sourceText لا فحص مادة — نداء قديم لا يُحكم عليه بلا مصدر");
    assert(cleanDescription("خاتم بفص دائري لامع. مصنوع من الذهب الخالص. مناسب للهدايا.", { sourceText: "خاتم" }) === "خاتم بفص دائري لامع. مناسب للهدايا.", "CQ-42: التنظيف يحذف جملة الخامة غير المثبتة كاملة");
    const sys = buildSeoSystem({ recent: [], keywords: [], existingDescription: "", visionNotes: "", visionLanguage: "ar", variants: [], styleExamples: [], profileBlock: "", taxonomyBlock: "" });
    assert(/آخر قطعة/.test(sys) && /«لون ذهبي» لا «ذهب»/.test(sys), "CQ-43: قواعد «الممنوعات» بالبرومبت الرئيسي");

    const silky = GOOD_DESC.replace("تنورة سوداء طويلة", "تنورة حرير طبيعي سوداء طويلة");
    const ai = mockAi([copyJson(silky), copyJson(GOOD_DESC)]);
    const out = await generateProductCopy({ env: { ...ai }, merchantId: "m_1", name: "تنورة", price: "", tone: "white", category: "", features: "", existingDescription: "", imageUrl: "", keywordsExtra: [] });
    assert(ai.seen.calls === 2 && /حرير/.test(ai.seen.systems[1]) && out.copywriting.description === withChart(GOOD_DESC), "CQ-44: وصف يذكر «حرير» والتاجر لم يذكره ⇒ إعادة محاولة تسمّي الخامة وتُعتمد النسخة السليمة");
    const ai2 = mockAi([copyJson(silky)]);
    const out2 = await generateProductCopy({ env: { ...ai2 }, merchantId: "m_1", name: "تنورة", price: "", tone: "white", category: "", features: "حرير طبيعي 100%", existingDescription: "", imageUrl: "", keywordsExtra: [] });
    assert(ai2.seen.calls === 1 && out2.copywriting.description === withChart(silky), "CQ-45: التاجر ذكر «حرير طبيعي» بالمزايا ⇒ لا إعادة ولا حذف");
  }

  // ── أمثلة الأسلوب المنقّحة تحمل عناصر نائبة {الخامة} — لا تصل صفحة متجر ──
  {
    const leak = (c) => descriptionQualityIssues(c).some((i) => i.code === "PLACEHOLDER_LEAK");
    assert(leak({ description: "تنورة كلوش سوداء. خامتها {الخامة}.", excerpt: "", whatsapp: "" }) && leak({ description: "سليم", excerpt: "", whatsapp: "تنورة {الخامة}" }), "CQ-46: معقوف بالوصف أو الواتساب يُمسك كتسرّب عنصر نائب");
    assert(!leak({ description: GOOD_DESC, excerpt: "نبذة", whatsapp: "واتساب" }), "CQ-47: وصف بلا معقوفات لا إنذار");
    assert(cleanDescription("تنورة كلوش سوداء طويلة. خامتها {الخامة}، وراجعي جدول المقاسات. مناسبة للسهرات.") === "تنورة كلوش سوداء طويلة. مناسبة للسهرات.", "CQ-48: التنظيف يحذف جملة العنصر النائب كاملة");
    const sys = buildSeoSystem({ recent: [], keywords: [], existingDescription: "", visionNotes: "", visionLanguage: "ar", variants: [], styleExamples: [{ text: "عباية كلوش… خامتها {الخامة}." }], profileBlock: "", taxonomyBlock: "" });
    assert(/عنصر نائب لا نص/.test(sys) && /ممنوع أي معقوف بالمخرج/.test(sys) && /أمثلة أسلوب مرجعية/.test(sys) && !/أمثلة أسلوب حقيقية ناجحة/.test(sys), "CQ-49: الأمثلة موسومة «مرجعية» لا «حقيقية ناجحة»، ومعها قاعدة المعقوفات");
    const leaky = GOOD_DESC.replace("متوفرة بمقاسات من XS إلى XL،", "خامتها {الخامة}.");
    const ai = mockAi([copyJson(leaky), copyJson(GOOD_DESC)]);
    const out = await generateProductCopy({ env: { ...ai }, merchantId: "m_1", name: "تنورة", price: "", tone: "white", category: "", features: "", existingDescription: "", imageUrl: "", keywordsExtra: [] });
    assert(ai.seen.calls === 2 && /معقوف/.test(ai.seen.systems[1]) && !/[{}]/.test(out.copywriting.description), "CQ-50: عنصر نائب بالمخرج ⇒ إعادة محاولة، والمنشور بلا معقوفات");
  }

  // ── التنظيف الحتمي ───────────────────────────────────────────────────────
  {
    const cleaned = cleanDescription(REAL_BAD);
    assert(/^تنورة نسائية/.test(cleaned), "CQ-9: الافتتاحية الإشارية تُسقط والجملة تبقى مقروءة");
    assert(!/ريال|السعر/.test(cleaned), "CQ-10: جملة السعر تُحذف كاملة لا الرقم وحده");
    assert(/مناسبة للسهرات/.test(cleaned), "CQ-11: الجمل السليمة لا تُمسّ");
    assert(cleanDescription("") === "" && cleanDescription(null) === "", "CQ-12: مدخل فارغ ⇒ فارغ بلا رمي");
  }

  // ── القواعد بالبرومبت ───────────────────────────────────────────────────
  {
    const sys = buildSeoSystem({ recent: [], keywords: ["تنورة"], existingDescription: "", visionNotes: "تنورة سوداء", visionLanguage: "ar", variants: [], styleExamples: [], profileBlock: "", taxonomyBlock: "" });
    assert(/ممنوع أن يبدأ الوصف أو النبذة بكلمة إشارية/.test(sys), "CQ-13: قاعدة الافتتاحية بالبرومبت");
    assert(/ممنوع ذكر أي سعر أو رقم بالريال داخل الوصف/.test(sys), "CQ-14: قاعدة السعر بالبرومبت");
    assert(/وستثنينية/.test(sys) && /سلامة اللغة/.test(sys), "CQ-15: قاعدة سلامة الإملاء بمثالها الحقيقي");
    // قسم القواعد فقط — برومبت الشخصية قبله له ترقيمه المستقل.
    const rulesSection = sys.slice(sys.indexOf("## مهمتك الآن"));
    const nums = [...rulesSection.matchAll(/^\s*(\d+)\. /gm)].map((m) => Number(m[1]));
    assert(new Set(nums).size === nums.length, `CQ-16: لا رقم قاعدة مكرر بالبرومبت (${nums.join(",")})`);
  }

  // ── السلوك: إعادة محاولة تسمّي العيب، ثم قسر ────────────────────────────
  {
    const ai = mockAi([copyJson(REAL_BAD), copyJson(GOOD_DESC)]);
    const out = await generateProductCopy({ env: { ...ai }, merchantId: "m_1", name: "تنورة", price: "83", tone: "white", category: "تنانير", features: "", existingDescription: "", imageUrl: "", keywordsExtra: [] });
    assert(ai.seen.calls === 2, "CQ-17: وصف معيب ⇒ إعادة محاولة واحدة");
    assert(/إعادة كتابة مطلوبة/.test(ai.seen.systems[1]) && /افتتاحية إشارية/.test(ai.seen.systems[1]) && /سعراً/.test(ai.seen.systems[1]), "CQ-18: تعليمة الإعادة تسمّي العيوب المرصودة بالضبط");
    assert(out.copywriting.description === withChart(GOOD_DESC), "CQ-19: المحاولة الثانية السليمة تُعتمد");
    assert(!/السعر/.test(ai.seen.users[0]), "CQ-20: السعر لا يُمرَّر للنموذج أصلاً (يبقى لـJSON-LD فقط)");
    assert(ai.seen.opts[0].temperature === 0.35, "CQ-21: حرارة الوصف 0.35 تصل لـWorkers AI");
    assert(out.seo.jsonLdSchema?.offers?.price === "83", "CQ-22: السعر ما زال بـJSON-LD رغم غيابه عن البرومبت");
  }
  {
    const ai = mockAi([copyJson(REAL_BAD)]); // يصرّ على نفس المخرج
    const out = await generateProductCopy({ env: { ...ai }, merchantId: "m_1", name: "تنورة", price: "", tone: "white", category: "", features: "", existingDescription: "", imageUrl: "", keywordsExtra: [] });
    assert(ai.seen.calls === 2, "CQ-23: الإصرار ⇒ محاولتان فقط لا حلقة");
    assert(/^تنورة نسائية/.test(out.copywriting.description) && !/ريال/.test(out.copywriting.description), "CQ-24: عند الإصرار يُنشر النص منظَّفاً — لا «هذي» ولا سعر");
  }
  {
    // إعادة المحاولة ترجع JSON مكسوراً: نبقي المخرج الأول (منظَّفاً) بدل رمي خطأ.
    const ai = mockAi([copyJson(REAL_BAD), "نص حر"]);
    const out = await generateProductCopy({ env: { ...ai }, merchantId: "m_1", name: "تنورة", price: "", tone: "white", category: "", features: "", existingDescription: "", imageUrl: "", keywordsExtra: [] });
    assert(!/^هذي/.test(out.copywriting.description), "CQ-25: فشل إعادة المحاولة لا يُسقط المنتج — المخرج الأول يُنظَّف ويُعتمد");
  }

  // ── الحرارة تصل لكل الطبقات ─────────────────────────────────────────────
  {
    let groqBody = null;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (_u, o) => { groqBody = JSON.parse(o.body); return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }); };
    try {
      await askWorkersAI({ env: { GROQ_API_KEY: "k" }, system: "s", messages: [{ role: "user", content: "u" }], temperature: 0.35, skipCache: true });
    } finally { globalThis.fetch = realFetch; }
    assert(groqBody?.temperature === 0.35, "CQ-26: الحرارة تُمرَّر للطبقة الاحتياطية (Groq) لا لـWorkers AI وحدها");
    globalThis.fetch = async (_u, o) => { groqBody = JSON.parse(o.body); return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }); };
    try {
      await askWorkersAI({ env: { GROQ_API_KEY: "k" }, system: "s", messages: [{ role: "user", content: "u" }], skipCache: true });
    } finally { globalThis.fetch = realFetch; }
    assert(groqBody?.temperature === 0.7, "CQ-27: بلا حرارة محدَّدة تبقى 0.7 للمحادثة — لا تغيير سلوكي هناك");
  }
}

main().then(done);

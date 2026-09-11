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
    assert(codes.includes("TOO_SHORT"), "CQ-3: وصف ٣٥ كلمة رغم توفّر صورة يُمسك كقصير");
    assert(descriptionQualityIssues({ description: GOOD_DESC, excerpt: "نبذة", whatsapp: "واتساب" }, { hasVision: true }).length === 0, "CQ-4: وصف سليم يمرّ بلا إنذار كاذب");
    assert(descriptionQualityIssues({ description: "وصف قصير صادق.", excerpt: "", whatsapp: "" }, { hasVision: false }).length === 0, "CQ-5: بلا صورة لا يُعاقَب القِصَر — قاعدة «أقصر وأصدق» باقية");
    for (const opener of ["هذه عباية", "هذا فستان", "منتجنا المميز", "إليك تنورة", "نقدم لك"]) {
      assert(descriptionQualityIssues({ description: opener + " …" }).some((i) => i.code === "BAD_OPENER"), `CQ-6: افتتاحية «${opener.split(" ")[0]}» تُمسك`);
    }
    assert(descriptionQualityIssues({ description: "الوصف سليم", excerpt: "", whatsapp: "بس ٨٣ ريال" }).some((i) => i.code === "PRICE_IN_PROSE"), "CQ-7: السعر بنسخة الواتساب يُمسك أيضاً (أرقام عربية)");
    assert(!descriptionQualityIssues({ description: "تنورة بطول 95 سم بقصّة كلوش وخصر مرتفع مع انسدال ناعم." }).some((i) => i.code === "PRICE_IN_PROSE"), "CQ-8: رقم قياس (سم) ليس سعراً — لا إنذار كاذب");
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
    assert(out.copywriting.description === GOOD_DESC, "CQ-19: المحاولة الثانية السليمة تُعتمد");
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

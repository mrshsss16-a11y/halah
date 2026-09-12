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

    // مخرج حقيقي (فستان متجر المراجعة 2026-09-11 22:57 UTC): حكم بضمير متصل أفلت.
    const realDress = "فستان أسود بلا أكمام، يتميز بكسرات تزيد من جماله وأناقته. قصته ميدي مما يجعله مناسبًا للعديد من المناسبات.";
    assert(publishedFieldIssues({ copywriting: { description: realDress } }, { sourceText: "" }).some((i) => i.code === "FIELD_UNSOURCED_JUDGMENT"), "PL-26: «جماله وأناقته» بضمير متصل تُمسك (كانت تفلت)");
    const dressClean = cleanDescription(realDress, { sourceText: "", productName: "فستان" });
    const styled = cleanDescription("فستان أسود بحمالات وطبقات متتالية. يُلبس مع صندل رفيع وحقيبة صغيرة لإطلالة مسائية أنيقًا ومريحةً.", { sourceText: "", productName: "فستان" });
    assert(/يُلبس مع صندل رفيع وحقيبة صغيرة لإطلالة مسائية/.test(styled) && !/أنيق|مريح/.test(styled), `PL-29: الصفة المنوّنة («أنيقًا»، «مريحةً») تُزال وتبقى جملة التنسيق («${styled}»)`);
    const hanging = cleanDescription("فستان أسود بحمالات رفيعة وتجميع طبقات تعطي مظهراً أنيقاً. قصته ميدي تناسب المناسبات المسائية.", { sourceText: "", productName: "فستان" });
    assert(hanging === "فستان أسود بحمالات رفيعة وتجميع طبقات. قصته ميدي تناسب المناسبات المسائية.", `PL-31: «تعطي مظهراً أنيقاً» تُزال كاملة بلا بقايا معلّقة («${hanging}»)`);
    const { stripJudgments } = await import("../../functions/_lib/domain/copyPhrases.js");
    const leftover = stripJudgments("فستان أسود بحمالات رفيعة وتجميع طبقات تعطي مظهراً.");
    assert(leftover === "فستان أسود بحمالات رفيعة وتجميع طبقات.", `PL-32: بقايا «تعطي مظهراً.» تُزال بأداة العبارات («${leftover}»)`);
    const paras = "بلوزة بيضاء بأكمام قصيرة وياقة دائرية.\n\nتُنسَّق مع تنورة زرقاء وتُلبس في الدوام والزيارات.\n\nراجعي جدول المقاسات قبل الطلب.";
    assert(cleanDescription(paras, { sourceText: "", productName: "بلوزة" }) === paras, "PL-35: التنظيف يحفظ الفقرات — كان يصل كل الجمل بمسافة فيُنشر الوصف كتلة واحدة");
    const touch = cleanDescription("فستان أسود بحمالات رفيعة. يُنسَّق مع حقيبة يد صغيرة لإضافة لمسة أنيقة.", { sourceText: "", productName: "فستان" });
    assert(touch === "فستان أسود بحمالات رفيعة. يُنسَّق مع حقيبة يد صغيرة.", `PL-28: «لإضافة لمسة أنيقة» تُزال كاملة لا صفتها وحدها («${touch}»)`);
    assert(/^فستان أسود بلا أكمام، يتميز بكسرات\./.test(dressClean) && /قصته ميدي/.test(dressClean) && !/جمال|[أا]ناق/.test(dressClean), `PL-27: «تزيد من جماله وأناقته» تُزال وتبقى الجملة («${dressClean}»)`);
  }

  // ── البرومبت ─────────────────────────────────────────────────────────────
  {
    const base = { recent: [], keywords: [], existingDescription: "", visionNotes: VISION_NOTES, visionLanguage: "ar", variants: [], styleExamples: [], profileBlock: "", taxonomyBlock: "" };
    assert(/اكتبي عن «بلوزة» وحده/.test(buildSeoSystem({ ...base, productName: "بلوزة" })), "PL-11: البرومبت يسمّي المنتج ويجعل قطع العارضة تنسيقاً فقط");
    assert(!/تلبسها العارضة/.test(buildSeoSystem(base)), "PL-12: بلا اسم منتج لا تُحقن القاعدة (سلوك سابق محفوظ)");
    const { VISION_PROMPT } = await import("../../functions/_lib/ai/prompts/seo.js");
    assert(/لا وضعية العارضة ولا يديها/.test(VISION_PROMPT) && /أي دانتيل أو تطريز/.test(VISION_PROMPT), "PL-21: توجيه الرؤية يحصر الوصف بالقطعة المعروضة ويفحص الياقة والأكمام والتفاصيل بالترتيب");
    assert(/«ميدي» ينتهي بين الركبة والكاحل/.test(VISION_PROMPT) && /«ماكسي» يصل الكاحل/.test(VISION_PROMPT), "PL-33: توجيه الرؤية يعرّف الأطوال بالنسبة للجسم (Qwen سمّى نفس الفستان ميدي ثم ماكسي)");
    assert(/«الكتفان والحمالات: …»/.test(VISION_PROMPT), "PL-30: الحمالات سطر مستقل — ملاحظة «الياقة: دائرية بحمالات» صارت «فستان دائري»");
    assert(/«الياقة: …»/.test(VISION_PROMPT) && /«التفاصيل: …»/.test(VISION_PROMPT) && /ولا يتناقض سطران/.test(VISION_PROMPT) && !/المرئية: …/.test(VISION_PROMPT), "PL-25: ملاحظات الرؤية منظّمة بسطر لكل جانب (ملاحظات حقيقية سابقة تناقضت: «قصيرة وبدون أكمام ظاهرة»)");
  }

  // ── التكامل: إعادة الطول مع صورة ─────────────────────────────────────────
  {
    const ai = mockAi([copyJson(REAL_BLOUSE), copyJson(REAL_BLOUSE), LONG_GOOD]);
    const out = await withImageFetch(() => generateProductCopy(args({ ...ai }, { imageUrl: "https://cdn.example.com/blouse.jpg" })));
    assert(ai.seen.vision >= 1 && ai.seen.text === 3, `PL-13: قصير بعد الإعادة العامة ⇒ كاتب وصف مركّز ثالث (نصية: ${ai.seen.text})`);
    assert(/اكتبي وصف «بلوزة» فقط/.test(ai.seen.systems[2]) && !/specsTable/.test(ai.seen.systems[2]) && ai.seen.systems[2].length < 2000, "PL-14: الكاتب المركّز برومبت قصير مستقل لحقل الوصف وحده، بلا مخطط JSON");
    assert(out.copywriting.description === LONG_GOOD, "PL-15: النسخة الطويلة السليمة تُعتمد");
  }
  {
    // الكاتب المركّز يعيد نصاً طويلاً فيه حكم: يُنظَّف قبل القبول، والمنشور = المقبول.
    const withJudgment = LONG_GOOD.replace("مع تفصيل دانتيل ظاهر على الكتف والكم.", "مع تفصيل دانتيل ظاهر على الكتف والكم تعطيها مظهراً أنيقاً.");
    const ai = mockAi([copyJson(REAL_BLOUSE), copyJson(REAL_BLOUSE), withJudgment]);
    const out = await withImageFetch(() => generateProductCopy(args({ ...ai }, { imageUrl: "https://cdn.example.com/blouse.jpg" })));
    const d = out.copywriting.description;
    assert(!/أنيق|مظهراً/.test(d) && /^بلوزة بيضاء/.test(d) && d.split(/\s+/).filter(Boolean).length >= 35, `PL-34: نص الكاتب المركّز يُنظَّف قبل قبوله فلا يقصّه التنظيف لاحقاً تحت حد الطول (${d.split(/\s+/).length} كلمة)`);
    {
      const seenSys = [];
      const typoAi = { AI: { run: async (_m, input) => {
        if (Array.isArray(input?.messages?.[0]?.content)) return { response: "فستان أسود بطبقات كاسرات أفقية وحمالات رفيعة." };
        seenSys.push(input?.messages?.[0]?.content || "");
        return { response: copyJson(LONG_GOOD) };
      } } };
      await withImageFetch(() => generateProductCopy(args({ ...typoAi }, { name: "فستان", imageUrl: "https://cdn.example.com/dress.jpg" })));
      assert(seenSys.length > 0 && !/كاسرات/.test(seenSys[0]) && /طبقات كسرات أفقية/.test(seenSys[0]), "PL-38: «كاسرات» من نموذج الرؤية تُصحَّح إلى «كسرات» قبل الكاتب");
    }
    {
      const { fixNoteLabels } = await import("../../functions/_lib/domain/copyPhrases.js");
      const real = "فستان أسود يمتاز بياقة حمالات وبلا أكمام، مع تفاصيل طبقات أفقية بارزة تضيف لمسة جمالية فريدة. الطول والقصّة ميدي مع طبقات متدرجة من الخصر حتى منتصف الساق، ما يجعله مناسبًا للمناسبات الخاصة.";
      const c = cleanDescription(real, { sourceText: "", productName: "فستان" });
      assert(c === "فستان أسود يمتاز بياقة حمالات وبلا أكمام، مع تفاصيل طبقات أفقية بارزة. الطول والقصّة ميدي مع طبقات متدرجة من الخصر حتى منتصف الساق، ما يجعله مناسبًا للمناسبات الخاصة.", `PL-39: «تضيف لمسة جمالية فريدة» تُزال كاملة («${c}»)`);
      const f = fixNoteLabels(c);
      assert(f === "فستان أسود يمتاز بحمالات وبلا أكمام، مع تفاصيل طبقات أفقية بارزة. بطول ميدي مع طبقات متدرجة من الخصر حتى منتصف الساق، ما يجعله مناسبًا للمناسبات الخاصة.", `PL-40: عناوين الملاحظات لا تُنشر («${f}»)`);
    }
    {
      // ملاحظات Qwen الحقيقية لبلوزة متجر المراجعة (2026-09-12 00:06).
      const realNotes = "اللون: أبيض مع أجزاء سفلية بدرجات من الأزرق السماوي والكحلي. الياقة: دائرية ومفتوحة. الأكمام: قصيرة ومبطنة بالدانتيل. التفاصيل: كسرات تجميع واضحة عند منطقة الصدر. الطول والقصّة: توب بقصّة واسعة، ومرفق به تنورة بقصّة A تنتهي عند منطقة الركبة.";
      const seenSys = [];
      let visionPromptSeen = "";
      const outfitAi = { AI: { run: async (_m, input) => {
        const c = input?.messages?.[0]?.content;
        if (Array.isArray(c)) { visionPromptSeen = JSON.stringify(input); return { response: realNotes }; }
        seenSys.push(c || "");
        return { response: copyJson(LONG_GOOD) };
      } } };
      await withImageFetch(() => generateProductCopy(args({ ...outfitAi }, { imageUrl: "https://cdn.example.com/blouse.jpg" })));
      const all = seenSys[0] || ""; const sys = all.slice(all.lastIndexOf("اللون:"), all.indexOf("---", all.lastIndexOf("اللون:")));
      assert(sys && !/تنورة|أجزاء سفلية|السماوي|مبطنة/.test(sys) && /دائرية ومفتوحة/.test(sys) && /مطعّمة بالدانتيل/.test(sys) && /توب بقصّة واسعة/.test(sys), "PL-41: ملاحظات الطقم تُصفّى مقطعاً مقطعاً — التنورة وألوانها و«مبطنة» لا تصل الكاتب، وتفاصيل البلوزة تبقى");
      assert(/القطعة المعروضة للبيع: «بلوزة»/.test(visionPromptSeen), "PL-42: اسم المنتج يصل نموذج الرؤية ليحدد القطعة");
    }
    {
      const claim = LONG_GOOD + "\n\nالبلوزة مرفق بها تنورة زرقاء بقصّة A.";
      const ai = mockAi([copyJson(claim)]);
      const out = await generateProductCopy(args({ ...ai }));
      assert(out.copywriting.description === LONG_GOOD, `PL-43: ادعاء «مرفق بها تنورة» يُحذف من المنشور، وجملة التنسيق «تحت التنورة» تبقى («${out.copywriting.description}»)`);
      const { stripJudgments } = await import("../../functions/_lib/domain/copyPhrases.js");
      const look = stripJudgments("للمرأة التي تبحث عن إطلالة أنيقة وعملية في يومها.");
      assert(look === "للمرأة التي تبحث عن إطلالة عملية في يومها.", `PL-44: «إطلالة أنيقة وعملية» ⇒ «إطلالة عملية» بلا واو معلّقة («${look}»)`);
    }
    {
      const o = { sourceText: "", productName: "بلوزة" };
      const modern = cleanDescription("بطول ميدي وقصّة أوسع من الجسم مع تجميع عند منطقة الصدر، هذه البلوزة توفر مظهراً عصرياً.", o);
      assert(modern === "بطول ميدي وقصّة أوسع من الجسم مع تجميع عند منطقة الصدر.", `PL-45: «هذه البلوزة توفر مظهراً عصرياً» تُزال بلا بقايا («${modern}»)`);
      const look2 = cleanDescription("تُلبس في العمل خلال الصيف، ويمكن تنسيقها مع تنورة قصيرة لإطلالة أنيقة.", o);
      assert(look2 === "تُلبس في العمل خلال الصيف، ويمكن تنسيقها مع تنورة قصيرة.", `PL-46: «لإطلالة» المعلّقة بعد حذف الصفة تُزال («${look2}»)`);
      const { dropUnseenLength } = await import("../../functions/_lib/domain/copyPhrases.js");
      const unseen = dropUnseenLength("بلوزة بيضاء.\n\nبطول ميدي وقصّة أوسع من الجسم.", "اللون: أبيض. الطول والقصّة: بلوزة بقصّة أوسع من الجسم.");
      assert(unseen === "بلوزة بيضاء.\n\nقصّة أوسع من الجسم.", `PL-47: طول لم تذكره ملاحظات الصورة يُحذف والفقرات تبقى («${unseen}»)`);
      assert(dropUnseenLength("فستان أسود بطول ميدي.", "الطول والقصّة: ميدي.") === "فستان أسود بطول ميدي.", "PL-48: الطول الوارد بالملاحظات يبقى");
      const { readFileSync } = await import("node:fs");
      const copySrc = readFileSync(new URL("../../functions/_lib/domain/copy.js", import.meta.url), "utf8");
      assert(!/«بطول ميدي» لا/.test(copySrc) && /removed=\$\{removedByClean/.test(copySrc), "PL-49: مثال «بطول ميدي» لا يُزرع بتعليمات الكاتب، وما يحذفه التنظيف يُسجَّل");
    }
    {
      // جمل الكاتب المركّز الحقيقية كما حفظها سجل removed= (2026-09-12 00:21).
      const o = { sourceText: "", productName: "بلوزة" };
      const cases = [
        ["الياقة واسعة دائرية مع تجميع يضيف لمسة من الأناقة.", "الياقة واسعة دائرية مع تجميع.", "PL-50: «يضيف لمسة من الأناقة» تُزال وتبقى الياقة (كانت الجملة تُحذف كاملة)"],
        ["تأتي البلوزة بأكمام قصيرة ومطعّمة بالدانتيل، مما يضيف تفاصيل رائعة ومميزة.", "تأتي البلوزة بأكمام قصيرة ومطعّمة بالدانتيل.", "PL-51: مقطع «مما يضيف تفاصيل رائعة ومميزة» يُحذف كله"],
        ["تصميمها سادة بدون تطريز ظاهر، مما يجعلها مثالية للارتداء في مختلف المناسبات.", "تصميمها سادة بدون تطريز ظاهر.", "PL-52: مقطع «مما يجعلها مثالية للارتداء…» يُحذف كله لا «مثالية» وحدها"],
        ["بلوزة ذات لون أبيض جذاب، تتميز بقصّة واسعة تناسب مختلف الأذواق.", "بلوزة ذات لون أبيض، تتميز بقصّة واسعة.", "PL-53: «جذاب» حكم و«تناسب مختلف الأذواق» ادعاء عام — يُزالان وتبقى الافتتاحية"],
        ["يمكن ارتداء هذه البلوزة في المناسبات غير الرسمية مع زوج من الجينز الضيق لإطلالة بسيطة وأنيقة.", "يمكن ارتداء هذه البلوزة في المناسبات غير الرسمية مع زوج من الجينز الضيق لإطلالة بسيطة.", "PL-54: «وأنيقة» تُزال وتبقى جملة التنسيق"],
      ];
      for (const [input, expected, label] of cases) {
        const got = cleanDescription(input, o);
        assert(got === expected, `${label} («${got}»)`);
      }
    }
    assert(!/العارضة تلبس/.test(ai.seen.systems[0]) && /تفصيل دانتيل على الكتف/.test(ai.seen.systems[0]), "PL-19: جملة العارضة تُحذف من ملاحظات الصورة قبل الكاتب، وجمل المنتج تبقى");
    assert(!/اليد اليمنى/.test(ai.seen.systems[0]) && !/اليد اليمنى/.test(ai.seen.systems[2]), "PL-20: وضعية العارضة («اليد اليمنى في الجيب») تُحذف من الملاحظات بكل النداءات");
  }
  {
    // الكاتب المركّز أعاد نصاً سليماً بثلاث فقرات لكنه تحت حد الطول: أطول من الحالي ⇒ يُعتمد.
    const shortGood = "بلوزة بيضاء بأكمام قصيرة وياقة دائرية مع كسرات عند الصدر وتفصيل دانتيل على الكتف والكم.\n\nتُنسَّق مع بنطال بيج واسع للدوام والزيارات.\n\nراجعي جدول المقاسات قبل الطلب لاختيار المقاس المناسب.";
    const ai = mockAi([copyJson(REAL_BLOUSE), copyJson(REAL_BLOUSE), shortGood]);
    const out = await withImageFetch(() => generateProductCopy(args({ ...ai }, { imageUrl: "https://cdn.example.com/blouse.jpg" })));
    assert(out.copywriting.description === shortGood, `PL-36: نص الكاتب المركّز الأطول يُعتمد ولو تحت حد الطول، بفقراته وجملة جدول المقاسات («${out.copywriting.description}»)`);
    const { readFileSync } = await import("node:fs");
    const seoSrc = readFileSync(new URL("../../functions/_lib/ai/prompts/seo.js", import.meta.url), "utf8");
    assert(!/طويلة بقصّة كلوش|فستان طويل بقصّة/.test(seoSrc) && /«ميدي» تبقى «ميدي»/.test(seoSrc) && /«ميدي» تبقى «ميدي»/.test(ai.seen.systems[2]), "PL-37: لا أمثلة تزرع «طويل»/«كلوش»، والطول بكلمة الملاحظات بالبرومبتين (نُشر «فستان طويل بتصميم كلوش» لفستان ميدي)");
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

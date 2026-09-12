// قراءة صورة منظّمة ومحفوظة وحقائق يبنيها الكود (2026-09-12): نفس التنورة قُرئت «واسعة» ثم «مستقيمة».
import { readFileSync } from "node:fs";
import { createRunner } from "../_helpers.mjs";
import { visionFactsContext, structuredVisionBlock, settleVisionFacts, factsToNotes, applyVisionFacts } from "../../functions/_lib/domain/visionFacts.js";
import { generateProductCopy } from "../../functions/_lib/domain/copy.js";
import { PURGE_TABLES } from "../../functions/_lib/domain/merchantPurge.js";

const { assert, done } = createRunner("vision-facts");

function memoryDb() {
  const rows = new Map();
  const seen = { inserts: 0, selects: 0 };
  const stmt = (sql) => ({
    sql, args: [],
    bind(...a) { this.args = a; return this; },
    async first() {
      if (/FROM vision_facts/.test(sql)) { seen.selects += 1; const r = rows.get(this.args.join("|")); return r ? { facts: r } : null; }
      return null;
    },
    async run() {
      if (/INSERT INTO vision_facts/.test(sql)) { seen.inserts += 1; rows.set(`${this.args[0]}|${this.args[1]}`, this.args[2]); }
      return {};
    },
    all: async () => ({ results: [] })
  });
  return { rows, seen, DB: { prepare: stmt, batch: async () => [] } };
}

const FACTS_JSON = JSON.stringify({ color: "أسود", length: "ميدي", fit: "الواسعة", waist: "غير واضح", neckline: "دائرية", details: ["كسرات عريضة", "جيب سري"], surface: "لامع", pattern: "سادة", mood: "رسمي" });
const IMAGE = "https://cdn.example.com/skirt.jpg";

async function main() {
  {
    const db = memoryDb();
    const env = { DB: db.DB };
    const ctx = await visionFactsContext(env, { merchantId: "m_1", imageUrl: IMAGE, name: "تنورة", category: "البلايز" });
    assert(ctx.structured && ctx.key && !ctx.facts, "VFX-1: تنورة (ولو تحت تصنيف «البلايز») تُقرأ منظّمة، ولا حقائق محفوظة أول مرة");
    const notes = await settleVisionFacts(env, ctx, { merchantId: "m_1", name: "تنورة", text: `إليك النتيجة:\n${FACTS_JSON}\nانتهى`, model: "groq:qwen" });
    assert(notes === "اللون: أسود. الطول: ميدي. القصّة: واسعة. التفاصيل: كسرات عريضة. سطح القماش: لامع. النقشة: سادة. الطابع العام: رسمي.", `VFX-2: قيم خارج القوائم و«غير واضح» والياقة لتنورة تُهمل، والباقي بصيغة الأسطر («${notes}»)`);
    assert(db.seen.inserts === 1, "VFX-3: الحقائق الصالحة تُحفظ");
    const again = await visionFactsContext(env, { merchantId: "m_1", imageUrl: IMAGE, name: "تنورة", category: "" });
    const other = await visionFactsContext(env, { merchantId: "m_2", imageUrl: IMAGE, name: "تنورة", category: "" });
    assert(again.facts?.fit === "واسعة" && !other.facts, "VFX-4: نفس الصورة لنفس المتجر تعيد الحقائق المحفوظة، ولمتجر آخر لا");
    assert((await settleVisionFacts(env, ctx, { merchantId: "m_1", name: "تنورة", text: "اللون: أسود. القصّة: واسعة." })) === null, "VFX-5: مخرج غير JSON يبقى ملاحظات حرة كما كان");
    assert((await settleVisionFacts(env, { structured: true }, { merchantId: "m_1", name: "تنورة", text: '{"color":"غير واضح","fit":"مستقيمة جداً"}' })) === "", "VFX-6: JSON بلا حقيقتين صالحتين = بلا ملاحظات، لا تخمين");
  }
  {
    const perfume = await visionFactsContext({}, { merchantId: "m_1", imageUrl: IMAGE, name: "عطر عود", category: "عطور" });
    const skirt = structuredVisionBlock({ structured: true }, "تنورة");
    const dress = structuredVisionBlock({ structured: true }, "فستان");
    assert(!perfume.structured && structuredVisionBlock(perfume, "عطر عود") === "", "VFX-7: فئة غير مغطاة بلا صيغة منظّمة");
    assert(/كسرات عريضة \| بليسيه/.test(skirt) && /غير واضح/.test(skirt) && !/على شكل قارب/.test(skirt) && /على شكل قارب/.test(dress), "VFX-8: الصيغة تسرد القوائم، وبلا ياقة وأكمام للتنورة");
  }
  {
    const page = {
      copywriting: { description: "تنورة ميدي سوداء، تتميز بكسرات عريضة تبدأ من الخصر.\n\nتُنسّق مع بلوزة بيضاء للدوام." },
      seo: { title: "تنورة" },
      specsTable: [{ key: "القصة", value: "مستقيمة" }, { key: "المقاسات المتاحة", value: "36 - XS، 44 - XL" }],
      imageAlt: "تنورة"
    };
    const facts = { color: "أسود", length: "ميدي", fit: "واسعة", details: ["كسرات عريضة"], surface: "لامع", mood: "رسمي" };
    applyVisionFacts(page, facts, { name: "تنورة" });
    assert(page.copywriting.description === "تنورة ميدي سوداء بقصّة واسعة، بكسرات عريضة وقماش لامع.\n\nتُنسّق مع بلوزة بيضاء للدوام.", `VFX-9: الجملة الأولى من الحقائق بتذكير اللون وتأنيثه («${page.copywriting.description}»)`);
    assert(page.specsTable.map((r) => `${r.key}=${r.value}`).join(" | ") === "اللون=أسود | الطول=ميدي | القصّة=واسعة | التفاصيل=كسرات عريضة | سطح القماش=لامع | المقاسات المتاحة=36 - XS، 44 - XL", `VFX-10: المواصفات من الحقائق، وصف المقاسات يبقى (${page.specsTable.map((r) => r.key).join("،")})`);
    assert(page.seo.title === "تنورة ميدي سوداء بكسرات عريضة" && page.imageAlt === page.seo.title, `VFX-11: اسم عام ⇒ عنوان من الحقائق («${page.seo.title}»)`);
    const dress = { copywriting: { description: "وصف." }, seo: { title: "فستان سهرة كحلي طويل" } };
    applyVisionFacts(dress, { color: "وردي فاتح", length: "ماكسي", neckline: "على شكل V", sleeves: "بلا أكمام", details: ["دانتيل"] }, { name: "فستان سهرة كحلي طويل" });
    assert(dress.copywriting.description.startsWith("فستان سهرة كحلي طويل باللون الوردي الفاتح وطول ماكسي وياقة على شكل V وبلا أكمام، بدانتيل.") && dress.seo.title === "فستان سهرة كحلي طويل", `VFX-12: اسم التاجر المفصّل يبقى كما هو والحقائق بعده، و«وبلا أكمام»، والعنوان لا يُمس («${dress.copywriting.description}»)`);
    const blouse = { copywriting: { description: "" } };
    applyVisionFacts(blouse, { color: "وردي فاتح", sleeves: "قصيرة" }, { name: "بلوزة" });
    assert(blouse.copywriting.description === "بلوزة وردية فاتحة بأكمام قصيرة.", `VFX-13: «وردية فاتحة» لبلوزة («${blouse.copywriting.description}»)`);
    assert(factsToNotes({}) === "" && applyVisionFacts({ copywriting: { description: "كما هو" } }, { color: "أسود" }, { name: "تنورة" }).copywriting.description === "كما هو", "VFX-14: أقل من حقيقتين لا يغيّر شيئاً");
  }
  {
    const db = memoryDb();
    let visionCalls = 0;
    let visionPrompt = "";
    const copyJson = JSON.stringify({
      seo: { title: "تنورة", seoTitle: "تنورة ميدي سوداء", metaDescription: "تنورة ميدي سوداء بكسرات عريضة للمناسبات الرسمية والدوام.", focusKeyword: "تنورة ميدي", lsiKeywords: ["تنورة سوداء"] },
      copywriting: { excerpt: "تنورة ميدي سوداء بكسرات عريضة للمناسبات الرسمية والدوام.", description: "تنورة ميدي سوداء بقصّة مستقيمة، تتميز بكسرات عريضة تبدأ من الخصر وتنسدل حتى منتصف الساق بحركة واضحة.\n\nتُنسّق مع بلوزة بيضاء أو جاكيت قصير للدوام والمناسبات الرسمية والسهرات، وتُلبس مع حذاء بكعب أو صندل بسيط.\n\nراجعي جدول المقاسات قبل الطلب لاختيار المقاس المناسب.", highlights: ["كسرات عريضة تبدأ من الخصر", "طول ميدي يصل منتصف الساق"], whatsapp: "تنورة ميدي سوداء بكسرات عريضة للمناسبات الرسمية والدوام." },
      specsTable: [{ key: "القصة", value: "مستقيمة" }, { key: "المقاسات المتاحة", value: "36 - XS، 44 - XL" }],
      faqs: [{ q: "هل تناسب الدوام؟", a: "نعم، تُلبس للدوام مع بلوزة بيضاء." }], imageAlt: "تنورة", tags: ["تنورة ميدي"]
    });
    const AI = { run: async (_m, input) => {
      if (Array.isArray(input?.messages?.[0]?.content)) { visionCalls += 1; visionPrompt = JSON.stringify(input); return { response: FACTS_JSON }; }
      return { response: copyJson };
    } };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(new Uint8Array([255, 216, 255, 224]), { status: 200, headers: { "content-type": "image/jpeg" } });
    const args = { env: { AI, DB: db.DB }, merchantId: "m_1", name: "تنورة", price: "", tone: "white", category: "البلايز", features: "", existingDescription: "", imageUrl: IMAGE, keywordsExtra: [] };
    let first, second;
    try {
      first = await generateProductCopy(args);
      second = await generateProductCopy(args);
    } finally { globalThis.fetch = realFetch; }
    assert(/صيغة الإخراج/.test(visionPrompt) && db.seen.inserts === 1, "VFX-15: التوليد يطلب الصيغة المنظّمة ويحفظ الحقائق");
    assert(first.copywriting.description.startsWith("تنورة ميدي سوداء بقصّة واسعة، بكسرات عريضة وقماش لامع.") && !/مستقيم/.test(JSON.stringify(first)), `VFX-16: القصّة من الحقائق لا من الكاتب («${first.copywriting.description.slice(0, 80)}»)`);
    assert(visionCalls === 1 && second.copywriting.description.split("\n")[0] === first.copywriting.description.split("\n")[0] && JSON.stringify(second.specsTable) === JSON.stringify(first.specsTable), `VFX-17: إعادة التوليد لا تعيد قراءة الصورة، والحقائق نفسها (قراءات: ${visionCalls})`);
  }
  {
    // جولة ثبات 2026-09-12 — عباية حقيقية: حقائق Qwen كما حُفظت، ووصف الكاتب كما خرج.
    const abaya = { copywriting: { description: "عباية ماكسي سوداء فيونكة كلوش مطرزة بأكمام واسعة. السطح مطفي والنقشة سادة، مع أكمام واسعة.\n\nتأتي العباية مع طرحة، وتُنسق مع إطلالات يومية بسيطة." }, specsTable: [{ key: "الخامة", value: "كريب" }] };
    applyVisionFacts(abaya, { color: "أسود", length: "ماكسي", fit: "كلوش", sleeves: "واسعة", details: ["تطريز"], surface: "مطفي", pattern: "سادة", mood: "يومي" }, { name: "عباية فيونكة كلوش مطرزة" });
    assert(abaya.copywriting.description === "عباية فيونكة كلوش مطرزة باللون الأسود وطول ماكسي وأكمام واسعة، بقماش مطفي.\n\nتأتي العباية مع طرحة، وتُنسق مع إطلالات يومية بسيطة.", `VFX-19: اسم التاجر كما هو، بلا «بتطريز» لعباية «مطرزة» ولا «كلوش» مكررة، وجملة تكرار الحقائق تُحذف («${abaya.copywriting.description}»)`);
    assert(abaya.specsTable.some((r) => r.key === "الخامة" && r.value === "كريب"), "VFX-20: مواصفة التاجر (الخامة من مزاياه) تبقى");
    const db = memoryDb();
    const ctx = await visionFactsContext({ DB: db.DB }, { merchantId: "m_1", imageUrl: IMAGE, name: "فستان سهرة سماوي بذيل كحلي", category: "", sourceText: "الخامة تفتة ناعم كلوش غير قابل للتمدد؛ طول الفستان 60 إنش" });
    const notes = await settleVisionFacts({ DB: db.DB }, ctx, { merchantId: "m_1", name: "فستان سهرة سماوي بذيل كحلي", text: '{"color":"سماوي","length":"ماكسي","fit":"ضيقة","sleeves":"بلا أكمام"}' });
    assert(/القصّة: كلوش/.test(notes) && !/ضيقة/.test(notes) && ctx.facts.fit === "كلوش", `VFX-21: «كلوش» بمزايا التاجر تغلب «ضيقة» من الصورة («${notes}»)`);
    const sleevesOnly = await settleVisionFacts({}, { structured: true, sourceText: "أكمام واسعة" }, { name: "بلوزة", text: '{"color":"أبيض","fit":"مستقيمة"}' });
    assert(/القصّة: مستقيمة/.test(sleevesOnly), "VFX-22: «أكمام واسعة» بالمزايا ليست قصّة ولا تغيّر القراءة");
  }
  {
    const privacy = readFileSync(new URL("../../privacy.html", import.meta.url), "utf8").replace(/\s+/g, " ");
    assert(PURGE_TABLES.includes("vision_facts") && /نص مختصر لما ظهر في صورة المنتج/.test(privacy) && /لا تُخزَّن/.test(privacy), "VFX-18: الحقائق ضمن محو بيانات التاجر ومذكورة بمدد الاحتفاظ، والصورة نفسها لا تُخزَّن");
  }
}

main().then(done);

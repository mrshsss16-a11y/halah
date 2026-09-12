// ذاكرة دروس وكيل الوصف — طلب المالك 2026-09-12: يتعلم من أخطائه فيتجنبها.
import { createRunner } from "../_helpers.mjs";
import { detectLessons, lessonsBlock, learnFromCopy, loadLessons } from "../../functions/_lib/domain/copyLessons.js";
import { generateProductCopy } from "../../functions/_lib/domain/copy.js";

const { assert, done } = createRunner("copy-lessons");

const codesOf = (ls) => ls.map((l) => l.code);

function mockDb(rows, { failLessons = false } = {}) {
  const seen = { selects: 0, batches: [] };
  const stmt = (sql) => ({
    sql, args: [],
    bind(...a) { this.args = a; return this; },
    all: async () => {
      if (/copy_lessons/.test(sql)) { if (failLessons) throw new Error("no such table: copy_lessons"); return { results: rows }; }
      return { results: [] };
    },
    run: async () => ({}),
    first: async () => null
  });
  return {
    seen,
    DB: {
      prepare: (sql) => { if (/SELECT[\s\S]*copy_lessons/.test(sql)) seen.selects += 1; return stmt(sql); },
      batch: async (list) => { if (failLessons) throw new Error("no such table: copy_lessons"); seen.batches.push(list.map((x) => [x.sql, x.args])); return []; }
    }
  };
}

const copyJson = (description) => JSON.stringify({
  seo: { title: "تنورة ميدي", seoTitle: "تنورة ميدي بطبعات نباتية", metaDescription: "تنورة ميدي بطبعات نباتية وطبقات أفقية للإطلالات النهارية الصيفية، راجعي جدول المقاسات قبل الطلب لاختيار المقاس المناسب." },
  copywriting: { description, excerpt: "تنورة ميدي بطبعات نباتية.", whatsapp: "تنورة ميدي.", highlights: [] },
  specsTable: [], faqs: [], tags: []
});

async function main() {
  {
    const ls = detectLessons({
      draft: "تنورة ميدي أنيقة بطبقات، في أسفل كل couche طرف متموج، مع حذاء وقب鞋.",
      final: "تنورة بطبقات، في أسفل كل طبقة طرف متموج.",
      codes: ["PROP_ITEM", "UNKNOWN_CODE"],
      notes: "اللون: عاجي. التفاصيل: طبقات.",
      sourceText: "تنورة"
    });
    const c = codesOf(ls);
    assert(c.includes("PROP_ITEM") && c.includes("JUDGMENT") && c.includes("LATIN_WORD") && c.includes("FOREIGN_SCRIPT") && c.includes("UNSEEN_LENGTH") && !c.includes("UNKNOWN_CODE"), `CL-1: دروس الكاتب تُستخرج مما أصلحته الحراس (${c.join(",")})`);
    const latin = ls.find((l) => l.code === "LATIN_WORD");
    assert(latin?.wrong === "couche" && latin?.right === "طبقة" && ls.find((l) => l.code === "JUDGMENT")?.wrong === "أنيقة", "CL-2: الدرس يحمل الخطأ وصوابه («couche» ← «طبقة»، «أنيقة»)");
  }
  {
    const ls = detectLessons({ rawNotes: "اللون: وردة فاتح. الأكمام: لا يوجد. التفاصيل: كل couche بطرف متموج. العارضة تلبس بلوزة.", notes: "اللون: وردي فاتح." });
    const c = codesOf(ls);
    assert(c.includes("VISION_COLOR_WORD") && c.includes("VISION_EMPTY_LINE") && c.includes("VISION_LATIN") && c.includes("VISION_EXTRA_ITEM") && ls.every((l) => l.target === "vision"), `CL-3: دروس قارئ الصورة من ملاحظاته الخام (${c.join(",")})`);
  }
  {
    const clean = detectLessons({ draft: "فستان أنيق أسود بحمالات.", final: "فستان أنيق أسود بحمالات.", sourceText: "فستان أنيق", notes: "" });
    assert(clean.length === 0, `CL-4: لا درس كاذب — حكم ذكره التاجر، ولا طول بلا ملاحظات (${codesOf(clean).join(",")})`);
  }
  {
    const rows = [
      { code: "JUDGMENT", wrong_text: "«أنيقة»", right_text: "تفصيل مرئي", target: "writer" },
      { code: "VISION_COUNT", wrong_text: "«ثلاث طبقات» لخمس", right_text: "عدد بيقين", target: "vision" },
      { code: "LATIN_WORD", wrong_text: "couche", right_text: "طبقة", target: "both" }
    ];
    const w = lessonsBlock(rows, "writer");
    const v = lessonsBlock(rows, "vision");
    assert(/أنيقة/.test(w) && /couche/.test(w) && !/ثلاث طبقات/.test(w) && /ثلاث طبقات/.test(v) && /couche/.test(v) && !/أنيقة/.test(v), "CL-5: كل هدف يستلم دروسه ودروس «both» فقط");
    assert(w.indexOf("أنيقة") < w.indexOf("couche") && lessonsBlock([], "writer") === "", "CL-6: الترتيب كما جاء من D1 (الأكثر تكراراً أولاً)، وبلا دروس لا كتلة");
    assert((await loadLessons({})).length === 0 && (await learnFromCopy({}, { draft: "أنيقة" })) === 0, "CL-7: بلا D1 لا قراءة ولا كتابة ولا خطأ");
  }
  {
    const rows = [
      { code: "JUDGMENT", wrong_text: "«تضيف لمسة جمالية فريدة»", right_text: "تفصيل مرئي محدد", target: "writer" },
      { code: "VISION_COLOR_WORD", wrong_text: "«قاعدي فاتح»", right_text: "«عاجي»", target: "vision" }
    ];
    const db = mockDb(rows);
    let visionInput = "";
    const systems = [];
    const AI = { run: async (_m, input) => {
      const c = input?.messages?.[0]?.content;
      if (Array.isArray(c)) { visionInput = JSON.stringify(input); return { response: "اللون: وردة فاتح. التفاصيل: طبقات أفقية. الطول والقصّة: ميدي. الطابع العام: نهاري." }; }
      systems.push(c || "");
      return { response: copyJson("تنورة ميدي أنيقة بطبقات أفقية وطبعات نباتية بالأخضر والأزرق والوردي والأصفر، تنتهي عند منتصف الساق وتُلبس في النهار صيفاً مع بلوزة خفيفة وصندل مسطح ويمكن تنسيقها للخروجات اليومية.\n\nراجعي جدول المقاسات قبل الطلب لاختيار المقاس المناسب.") };
    } };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(new Uint8Array([255, 216, 255, 224]), { status: 200, headers: { "content-type": "image/jpeg" } });
    let out;
    try {
      out = await generateProductCopy({ env: { AI, DB: db.DB }, merchantId: "m_1", name: "تنورة", price: "", tone: "white", category: "", features: "", existingDescription: "", imageUrl: "https://cdn.example.com/skirt.jpg", keywordsExtra: [] });
    } finally { globalThis.fetch = realFetch; }
    assert(db.seen.selects === 1, `CL-8: الدروس تُقرأ بنداء D1 واحد لكل توليد (${db.seen.selects})`);
    assert(/قاعدي فاتح/.test(visionInput) && !/لمسة جمالية فريدة/.test(visionInput), "CL-9: دروس قارئ الصورة تصل توجيه الرؤية وحده");
    assert(/لمسة جمالية فريدة/.test(systems[0] || "") && !/قاعدي فاتح/.test(systems[0] || ""), "CL-10: دروس الكاتب تصل توجيه الكاتب وحده");
    const inserts = db.seen.batches.flat().filter(([sql]) => /INSERT INTO copy_lessons/.test(sql));
    const learned = inserts.map(([, args]) => args[0]);
    assert(learned.includes("JUDGMENT") && learned.includes("VISION_COLOR_WORD") && !/أنيقة/.test(out.copywriting.description), `CL-11: التوليد يعلّم الذاكرة ما أصلحته الحراس (${learned.join(",")})`);
  }
  {
    const db = mockDb([], { failLessons: true });
    const AI = { run: async () => ({ response: copyJson("تنورة بطبقات أفقية وطبعات نباتية بالأخضر والأزرق والوردي.") }) };
    const out = await generateProductCopy({ env: { AI, DB: db.DB }, merchantId: "m_1", name: "تنورة", price: "", tone: "white", category: "", features: "", existingDescription: "", imageUrl: "", keywordsExtra: [] });
    assert(/تنورة بطبقات/.test(out.copywriting.description), "CL-12: جدول الدروس غير مطبَّق أو عطل D1 لا يُسقط التوليد");
  }
}

main().then(done);

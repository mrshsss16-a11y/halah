// طبقة المتجهات: عزل إلزامي · سجل يجعل الحذف ممكناً · استرجاع بلا "undefined".
//
// ثلاث فجوات حقيقية يحرسها هذا الملف:
//  ١. «الحذف نهائي» بصفحة الخصوصية كان غير صحيح للذاكرة — `purgeMerchantData`
//     لا يلمس Vectorize، والمتجه يحمل نص التاجر الخام.
//  ٢. برومبتات الاسترجاع تبني `m.question`/`m.reply` بينما متجهات التاجر
//     `{text}` — فيصل النموذج «س: undefined ج: undefined».
//  ٣. العتبة كانت تقرأ `metadata.score` (قيمة ثابتة وقت التضمين) لا
//     `match.score` — أي أنها لم تكن تقيس تشابهاً إطلاقاً.
import { createRunner } from "../_helpers.mjs";

const { assert, done } = createRunner("vector-store");

const EMBED = [0.1, 0.2, 0.3];

/** AI مزيَّف: يردّ متجهاً لنداء التضمين، ونصاً لنداء التوليد (ويسجّل البرومبت). */
function fakeAI(capture = {}) {
  return {
    run: async (model, input) => {
      if (input?.text) return { data: [EMBED] };
      capture.system = input?.messages?.[0]?.content || "";
      return { response: "تمام، أقدر أساعدك." };
    }
  };
}

/** D1 مزيَّف يسجّل كل استعلام ووسائطه، ويردّ صفوفاً معدّة لـ.all(). */
function fakeDb(rows = []) {
  const calls = [];
  return {
    calls,
    prepare(q) {
      const norm = q.replace(/\s+/g, " ").trim();
      const stmt = {
        bind: (...b) => {
          calls.push({ q: norm, b });
          return { run: async () => ({}), all: async () => ({ results: rows }) };
        },
        run: async () => {
          calls.push({ q: norm, b: [] });
          return {};
        },
        all: async () => ({ results: rows })
      };
      return stmt;
    }
  };
}

function fakeIndex(matches = []) {
  const seen = { upserts: [], queries: [], deleted: [] };
  return {
    seen,
    upsert: async (items) => { seen.upserts.push(...items); },
    query: async (values, opts) => { seen.queries.push({ values, opts }); return { matches }; },
    deleteByIds: async (ids) => { seen.deleted.push([...ids]); }
  };
}

async function main() {
  const vs = await import("../../functions/_lib/ai/vectorStore.js");
  const mem = await import("../../functions/_lib/ai/memory.js");

  // ── ١. العزل إلزامي، لا ضمنيّ ───────────────────────────────────────────────
  {
    const env = { AI: fakeAI(), DB: fakeDb(), VECTORIZE_INDEX: fakeIndex() };
    let upsertThrew = false;
    let queryThrew = false;
    let deleteThrew = false;
    await vs.upsertVector(env, { storeId: "", kind: "memory", text: "نص" }).catch(() => { upsertThrew = true; });
    await vs.queryVectors(env, { storeId: null, text: "سؤال" }).catch(() => { queryThrew = true; });
    await vs.deleteVectorIds(env, { storeId: undefined, ids: ["x"] }).catch(() => { deleteThrew = true; });
    assert(
      upsertThrew && queryThrew && deleteThrew,
      "VEC-1: غياب storeId يرمي بالدوال الثلاث — لا كتابة ولا قراءة ولا حذف بلا عزل"
    );
    assert(
      env.VECTORIZE_INDEX.seen.upserts.length === 0 && env.VECTORIZE_INDEX.seen.deleted.length === 0,
      "VEC-2: الرمي قبل أي نداء على المؤشر — لا أثر جزئي"
    );
  }

  // ── ٢. كل استعلام يحمل فلتر المتجر ──────────────────────────────────────────
  {
    const index = fakeIndex([{ score: 0.9, metadata: { storeId: "m_a", kind: "memory", text: "سياسة الشحن ٣ أيام" } }]);
    const env = { AI: fakeAI(), DB: fakeDb(), VECTORIZE_INDEX: index };
    const out = await vs.queryVectors(env, { storeId: "m_a", text: "متى يوصل الطلب؟" });
    const { opts } = index.seen.queries[0];
    assert(
      opts?.filter?.storeId?.$eq === "m_a",
      "VEC-3: filter.storeId محقون بكل استعلام — لا مسار نداء يقدر ينساه"
    );
    assert(out.length === 1 && out[0].text === "سياسة الشحن ٣ أيام", "VEC-4: الاسترجاع يرجّع metadata المطابق");
  }

  // ── ٣. العتبة من match.score لا من metadata.score ───────────────────────────
  {
    // الحالة التي كانت تكشف الباغ: metadata تحمل score=10 (قيمة قديمة ثابتة)
    // بينما التشابه الفعلي 0.01 — الكود القديم كان يقبلها لأنها «>= 6».
    const index = fakeIndex([
      { score: 0.01, metadata: { storeId: "m_a", kind: "hala_faq", text: "لا علاقة", score: 10 } },
      { score: 0.88, metadata: { storeId: "m_a", kind: "hala_faq", text: "مرتبط فعلاً" } }
    ]);
    const env = { AI: fakeAI(), DB: fakeDb(), VECTORIZE_INDEX: index };
    const out = await vs.queryVectors(env, { storeId: "m_a", text: "سؤال" });
    assert(
      out.length === 1 && out[0].text === "مرتبط فعلاً",
      "VEC-5: التصفية بـmatch.score — متجه بعيد بـmetadata.score=10 يسقط"
    );
    assert(out[0].score === 0.88, "VEC-6: درجة التشابه الحقيقية تُمرَّر مع المقتطف");
  }

  // ── ٤. السجل يُكتب قبل المتجه، وشكل metadata موحَّد ─────────────────────────
  {
    const db = fakeDb();
    const index = fakeIndex();
    const env = { AI: fakeAI(), DB: db, VECTORIZE_INDEX: index };
    const order = [];
    const realUpsert = index.upsert;
    index.upsert = async (items) => { order.push("vector"); return realUpsert(items); };
    const realPrepare = db.prepare.bind(db);
    db.prepare = (q) => { if (/vector_refs/.test(q)) order.push("ref"); return realPrepare(q); };

    const id = await vs.upsertVector(env, { storeId: "m_a", kind: "merchant_note", text: "دوامنا ٩-٥", refId: "" });
    assert(order[0] === "ref" && order[1] === "vector", "VEC-7: صف vector_refs يُكتب قبل المتجه — لا متجه بلا سجل يحذفه");

    const ins = db.calls.find((c) => /INSERT OR REPLACE INTO vector_refs/.test(c.q));
    assert(
      ins && ins.b[0] === "m_a" && ins.b[1] === id && ins.b[2] === "merchant_note",
      "VEC-8: السجل يربط المعرّف بالتاجر ونوعه"
    );

    const meta = index.seen.upserts[0].metadata;
    assert(
      Object.keys(meta).sort().join(",") === "kind,refId,storeId,text,ts",
      "VEC-9: شكل metadata موحَّد {storeId, kind, text, refId, ts} — لا شكل لكل مستدعٍ"
    );
    assert(meta.text === "دوامنا ٩-٥" && meta.storeId === "m_a", "VEC-10: النص والمتجر داخل الـmetadata");
  }

  // ── ٥. الحذف يمحو المتجه ثم صفّه ────────────────────────────────────────────
  {
    const db = fakeDb();
    const index = fakeIndex();
    const env = { AI: fakeAI(), DB: db, VECTORIZE_INDEX: index };
    const n = await vs.deleteVectorIds(env, { storeId: "m_a", ids: ["a", "b", "a"] });
    assert(n === 2 && index.seen.deleted[0].join(",") === "a,b", "VEC-11: deleteByIds بدفعة واحدة بلا تكرار");
    const del = db.calls.find((c) => /DELETE FROM vector_refs/.test(c.q));
    assert(
      del && /WHERE merchant_id = \? AND vector_id IN/.test(del.q) && del.b[0] === "m_a",
      "VEC-12: محو السجل مقيَّد بالتاجر — لا مسح عابر للمتاجر"
    );
  }

  // ── ٦. أسئلة التاجر: معرّف حتمي (حفظ فوق نفسه = استبدال) ────────────────────
  {
    const index = fakeIndex();
    const env = { AI: fakeAI(), DB: fakeDb(), VECTORIZE_INDEX: index };
    const first = await mem.storeMerchantFaqVector({ env, merchantId: "m_a", faqId: 7, question: "الشحن؟", answer: "٣ أيام" });
    const second = await mem.storeMerchantFaqVector({ env, merchantId: "m_a", faqId: 7, question: "الشحن؟", answer: "يومان" });
    assert(
      first === second && first === "merchant_faq:m_a:7",
      "VEC-13: معرّف حتمي لسؤال التاجر — التعديل يستبدل المتجه بدل أن يضيف نسخة"
    );
    assert(
      index.seen.upserts[1].metadata.text.includes("يومان"),
      "VEC-14: الاستبدال يحمل الجواب الجديد"
    );

    const del = fakeIndex();
    const env2 = { AI: fakeAI(), DB: fakeDb(), VECTORIZE_INDEX: del };
    await mem.deleteMerchantFaqVector({ env: env2, merchantId: "m_a", faqId: 7 });
    assert(
      del.seen.deleted[0]?.[0] === "merchant_faq:m_a:7",
      "VEC-15: حذف السؤال يحذف متجهه بنفس المعرّف الحتمي"
    );
    assert(
      /deleteMerchantFaqVector\(\{ env, merchantId, faqId: body\.id \}\)/.test(
        await (await import("node:fs/promises")).readFile(new URL("../../functions/api/store/faq.js", import.meta.url), "utf8")
      ),
      "VEC-16: فرع الحذف بـapi/store/faq.js موصول فعلاً بحذف المتجه"
    );
  }

  // ── ٧. المحو النهائي: متجهات التاجر تسقط معه ────────────────────────────────
  {
    const { purgeMerchantData, PURGE_TABLES } = await import("../../functions/_lib/domain/merchantPurge.js");
    assert(PURGE_TABLES.includes("vector_refs"), "VEC-17: vector_refs ضمن جداول المحو (حارس PURGE-1)");

    const db = fakeDb([{ vector_id: "merchant_faq:m_a:1" }, { vector_id: "merchant_faq:m_a:2" }]);
    const index = fakeIndex();
    const out = await purgeMerchantData({ DB: db, VECTORIZE_INDEX: index }, "m_a");
    assert(
      index.seen.deleted.flat().join(",") === "merchant_faq:m_a:1,merchant_faq:m_a:2",
      "VEC-18: المحو يحذف متجهات التاجر فعلاً — «الحذف نهائي» صار صحيحاً للذاكرة"
    );
    const readIdx = db.calls.findIndex((c) => /SELECT vector_id FROM vector_refs/.test(c.q));
    const rowDeleteIdx = db.calls.findIndex((c) => /DELETE FROM vector_refs WHERE merchant_id = \?$/.test(c.q));
    assert(
      readIdx >= 0 && rowDeleteIdx > readIdx,
      "VEC-19: قراءة السجل قبل محو صفوفه — العكس يفقد المعرّفات إلى الأبد"
    );
    assert(out.purged === true && out.failed.length === 0, "VEC-20: المحو ينجح بلا فشل مسجَّل");
  }

  // ── ٨. فشل المتجهات يُدرَج بصدق، لا يُبتلع ──────────────────────────────────
  {
    const { purgeMerchantData } = await import("../../functions/_lib/domain/merchantPurge.js");
    const db = fakeDb([{ vector_id: "v1" }]);
    const index = fakeIndex();
    index.deleteByIds = async () => { throw new Error("vectorize unavailable"); };
    const out = await purgeMerchantData({ DB: db, VECTORIZE_INDEX: index }, "m_a");
    assert(
      out.failed.some((f) => /vector_refs: vectorize unavailable/.test(f)),
      "VEC-21: تعذّر حذف المتجهات يظهر بـresult.failed — لا ادعاء محو كامل"
    );
  }

  // ── ٩. لا "undefined" بأي برومبت استرجاع ────────────────────────────────────
  {
    // الشكل الحقيقي لذاكرة التاجر: نص واحد، بلا question/reply.
    const merchantMemories = [{ storeId: "m_a", kind: "merchant_faq", text: "س: الشحن؟\nج: ٣ أيام", refId: "1" }];
    const { buildSupportRagContext } = await import("../../functions/_lib/ai/prompts/support.js");
    const rag = buildSupportRagContext(merchantMemories);
    assert(rag.includes("٣ أيام") && !rag.includes("undefined"), "VEC-22: برومبت الودجت يحمل نص الذاكرة لا undefined");

    const { buildChatSystem } = await import("../../functions/_lib/ai/prompts/chat.js");
    const sys = buildChatSystem({
      dialect: "saudi_najdi",
      storeInstructions: "",
      examples: merchantMemories,
      products: []
    });
    assert(sys.includes("٣ أيام") && !sys.includes("undefined"), "VEC-23: برومبت معاينة المحادثة بلا undefined");

    const { formatMemory } = mem;
    assert(
      formatMemory({ question: "س؟", reply: "ج" }) === "س: س؟\nج: ج" &&
        formatMemory({ text: "نص" }) === "نص" &&
        formatMemory({}) === "",
      "VEC-24: formatMemory يقرأ النص، ويرجع للشكل القديم، ويُسقط ما لا محتوى له"
    );
  }

  // ── ١٠. واتساب: نفس الضمانة بالمسار الحي لا بالنص فقط ───────────────────────
  {
    const { autoReply } = await import("../../functions/_lib/domain/whatsappAutoReply.js");
    const capture = {};
    const env = {
      AI: fakeAI(capture),
      VECTORIZE_INDEX: fakeIndex([
        { score: 0.9, metadata: { storeId: "m_a", kind: "merchant_note", text: "نوصل للرياض خلال يومين" } }
      ])
    };
    const out = await autoReply(env, {
      merchantId: "m_a",
      isAuraLine: false,
      phone: "9665xxxxxxx",
      incomingText: "كم يستغرق التوصيل للرياض؟",
      contactName: "عميل",
      context: null,
      requestId: "t1"
    });
    assert(out && typeof out.text === "string", "VEC-25: مسار الرد التلقائي يعمل بذاكرة تاجر");
    assert(
      capture.system.includes("نوصل للرياض خلال يومين"),
      "VEC-26: نص ذاكرة التاجر يصل برومبت واتساب فعلاً"
    );
    assert(!/undefined/.test(capture.system), "VEC-27: صفر «undefined» ببرومبت واتساب");
  }

  // ── ١١. الحارس ح١٠: المؤشر مملوك لملف واحد ──────────────────────────────────
  {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(process.cwd(), "functions");
    const walk = (dir, out = []) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (p.endsWith(".js")) out.push(p);
      }
      return out;
    };
    const offenders = walk(root).filter(
      (f) =>
        !f.replace(/\\/g, "/").endsWith("functions/_lib/ai/vectorStore.js") &&
        /VECTORIZE_INDEX\s*\.\s*(query|upsert|insert|deleteByIds|getByIds)\s*\(/.test(readFileSync(f, "utf8"))
    );
    assert(offenders.length === 0, `VEC-28: لا نداء على VECTORIZE_INDEX خارج vectorStore.js (${offenders.length})`);
    assert(
      /ح١٠/.test(readFileSync(join(process.cwd(), "scripts/audit-security.mjs"), "utf8")),
      "VEC-29: الحارس ح١٠ مكتوب بتدقيق الأمن فيمنع الارتداد آلياً"
    );
  }
}

main()
  .then(() => done())
  .catch((e) => {
    console.error("❌ Tests threw an exception:");
    console.error(e);
    process.exit(1);
  });

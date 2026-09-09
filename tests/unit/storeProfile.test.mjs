import { createRunner } from "../_helpers.mjs";

const { assert, done } = createRunner("storeProfile");

async function main() {
  // ── بصمة المتجر (المرحلة ٣ من docs/PLAN_BULK_SEO.md) ───────────────────────
  // ثلاثة أشياء تُختبَر لأن كسرها صامت ومكلف:
  //  ١. **استدعاء AI واحد لا ٤٠** — الخطأ هنا يحرق حصة التاجر كاملة بضغطة زر.
  //  ٢. **بصمة غير معتمَدة لا تُحقن** — الحقن قبل الاعتماد يطبّق قرار نموذج على
  //     ٢٠٠ منتج بلا موافقة إنسان.
  //  ٣. **بلا بصمة السلوك كما كان** — الجدول (0019) غير مطبَّق بعد، فأي اعتماد
  //     على وجوده يُسقط توليد المحتوى للجميع.
  {
    const {
      buildProfile,
      getProfile,
      approveProfile,
      profileToPromptBlock,
      normalizeProfile
    } = await import("../../functions/_lib/domain/storeProfile.js");
    const { approvedProfileBlock } = await import("../../functions/_lib/domain/copy.js");
    const { buildSeoSystem } = await import("../../functions/_lib/ai/prompts/seo.js");

    const SAMPLE = [
      { name: "عباية كلوش كريب", category: "عبايات", current_description: "عباية كريب ياباني بقصة كلوش." },
      { name: "قهوة إثيوبية", category: "قهوة", current_description: "حبوب مغسولة بنكهة فاكهية." }
    ];
    const MODEL_JSON = JSON.stringify({
      categories: ["عبايات", "قهوة مختصة"],
      audience: "نساء سعوديات يهتمن بالخامة",
      toneNotes: ["جمل قصيرة", "تبدأ بالخامة"],
      vocabulary: ["كريب ياباني", "مغسولة"],
      forbidden: ["مبالغة إعلانية"],
      anchorKeywords: ["أصلي", "فاخر"]
    });

    /** DB وهمي يسجّل كل استعلام — نتحقق من العزل بالنص لا بالنية. */
    function profileDb(log, { sample = SAMPLE, row = null } = {}) {
      return {
        prepare(sql) {
          return {
            bind(...args) {
              log.push({ sql, args });
              return {
                all: async () => ({ results: sample }),
                first: async () => row,
                run: async () => ({ meta: { changes: 1 } })
              };
            }
          };
        }
      };
    }

    // ① استدعاء AI واحد على العيّنة كلها — لا واحد لكل منتج.
    const buildLog = [];
    let aiCalls = 0;
    const built = await buildProfile(
      { DB: profileDb(buildLog) },
      {
        merchantId: "m_1",
        ask: async () => {
          aiCalls++;
          return MODEL_JSON;
        }
      }
    );
    assert(aiCalls === 1, `SP-1: buildProfile يستدعي النموذج مرة واحدة فقط (${aiCalls})`);
    assert(built.status === "draft", "SP-2: البصمة المبنية تُخزَّن مسودة لا معتمَدة");
    assert(
      buildLog.every((q) => /merchant_id/.test(q.sql)) && buildLog.every((q) => q.args[0] === "m_1"),
      "SP-3: كل استعلام بـbuildProfile معزول بـmerchant_id"
    );
    assert(
      buildLog.some((q) => /FROM store_products/.test(q.sql) && q.args[1] === 40),
      "SP-4: العيّنة مقيّدة بـ٤٠ منتج كحد أقصى"
    );

    // العزل fail-closed: بلا merchantId ترمي، لا تقرأ منتجات الجميع.
    let threwProfile = false;
    try {
      await buildProfile({ DB: profileDb([]) }, { merchantId: "", ask: async () => MODEL_JSON });
    } catch {
      threwProfile = true;
    }
    assert(threwProfile, "SP-5: buildProfile بلا merchantId ترمي (fail closed)");

    // ② بوابة الاعتماد — الفرق بين draft وapproved.
    const draftRow = { profile: MODEL_JSON, status: "draft", source_sample: 2, updated_at: "x" };
    const approvedRow = { ...draftRow, status: "approved" };

    const draft = await getProfile({ DB: profileDb([], { row: draftRow }) }, { merchantId: "m_1" });
    const approved = await getProfile({ DB: profileDb([], { row: approvedRow }) }, { merchantId: "m_1" });
    assert(approvedProfileBlock(draft) === "", "SP-6: بصمة draft لا تُحقن إطلاقاً");
    assert(
      approvedProfileBlock(approved).includes("عبايات"),
      "SP-7: بصمة approved تُحقن بمحتواها"
    );
    assert(approvedProfileBlock(null) === "", "SP-8: بلا بصمة = بلا حقن");

    // العزل بالقراءة.
    const readLog = [];
    await getProfile({ DB: profileDb(readLog, { row: approvedRow }) }, { merchantId: "m_2" });
    assert(
      readLog.length === 1 && /merchant_id = \?/.test(readLog[0].sql) && readLog[0].args[0] === "m_2",
      "SP-9: قراءة البصمة مشروطة بـmerchant_id"
    );

    // الاعتماد يكتب على صف التاجر نفسه فقط، ونسخة التاجر المعدّلة تمرّ بالتطبيع.
    const approveLog = [];
    const approvedOut = await approveProfile(
      { DB: profileDb(approveLog, { row: draftRow }) },
      { merchantId: "m_3", profile: { categories: ["عطور"], audience: "ي", forbidden: [] } }
    );
    assert(
      approvedOut.status === "approved" &&
        approveLog.some((q) => /UPDATE store_profiles/.test(q.sql) && /merchant_id = \?/.test(q.sql)),
      "SP-10: approveProfile يحدّث صف التاجر وحده بحالة approved"
    );
    assert(
      Array.isArray(approvedOut.profile.toneNotes) && approvedOut.profile.vocabulary.length === 0,
      "SP-11: بصمة العميل تمرّ بالتطبيع — لا نثق بشكل ما يرسله"
    );

    // ③ السلوك القديم محفوظ حرفياً بلا بصمة: نفس البرومبت بالضبط.
    const baseArgs = { recent: [], keywords: ["عباية"], existingDescription: "", visionNotes: null, styleExamples: [] };
    const without = buildSeoSystem({ ...baseArgs });
    const withEmpty = buildSeoSystem({ ...baseArgs, profileBlock: "" });
    const withBlock = buildSeoSystem({ ...baseArgs, profileBlock: approvedProfileBlock(approved) });
    assert(without === withEmpty, "SP-12: بلا بصمة، البرومبت مطابق حرفياً للسلوك السابق");
    assert(
      withBlock.length > without.length && withBlock.includes("بصمة هذا المتجر"),
      "SP-13: مع بصمة معتمَدة، الكتلة تُحقن بالـsystem prompt"
    );

    // المرساة: نفس النص حرفياً لكل منتج — لو تغيّر بين استدعاءين انهار الغرض.
    assert(
      profileToPromptBlock(approved.profile) === profileToPromptBlock(approved.profile),
      "SP-14: كتلة البصمة ثابتة (مرساة) لا تتغيّر بين الاستدعاءات"
    );
    assert(
      profileToPromptBlock(normalizeProfile({})) === "",
      "SP-15: بصمة فارغة ترجّع كتلة فارغة لا كتلة هيكلية بلا محتوى"
    );

    // نافذة recentCopy مثبّتة على ٥ (الخطة §٥) — تُقرأ من نص copy.js نفسه.
    const { readFileSync } = await import("node:fs");
    const copySrc = readFileSync(new URL("../../functions/_lib/domain/copy.js", import.meta.url), "utf8")
      + readFileSync(new URL("../../functions/api/copy.js", import.meta.url), "utf8");
    assert(
      /RECENT_OPENINGS_WINDOW\s*=\s*5/.test(copySrc) &&
        /recentCopy\(env,\s*merchantId,\s*RECENT_OPENINGS_WINDOW\)/.test(copySrc),
      "SP-16: نافذة recentCopy مثبّتة على ٥ فلا تنجرف عبر دفعة كبيرة"
    );
    // المصادقة التي أُضيفت لإغلاق ثغرات سابقة لم تُنقض بحقن البصمة.
    assert(
      /requireCompletedAccount\(request, env, body\.storeId\)/.test(copySrc),
      "SP-17: copy.js لا يزال يفرض requireCompletedAccount — الحقن ما نقض المصادقة"
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

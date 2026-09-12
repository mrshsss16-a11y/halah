import { createRunner } from "../_helpers.mjs";

const { assert, done } = createRunner("copy-vision");

async function main() {
  // ── تحليل الصورة: "وفق الصورة" لا اختلاق (بلاغ 2026-09-07) ────────────────
  {
    const { readFileSync } = await import("node:fs");
    const { VISION_PROMPT, buildSeoSystem } = await import("../../functions/_lib/ai/prompts/seo.js");
    const copySrc = readFileSync(new URL("../../functions/_lib/ai/prompts/seo.js", import.meta.url), "utf8");
    const copyDomainSrc = readFileSync(new URL("../../functions/_lib/domain/copy.js", import.meta.url), "utf8");

    assert(
      /صف ما تراه في الصورة فقط/.test(VISION_PROMPT) &&
        /ممنوع الاستنتاج أو الافتراض/.test(VISION_PROMPT),
      "VIS-1: توجيه الرؤية يحصر المخرَج بما هو مرئي ويمنع الاستنتاج"
    );
    assert(
      /عند أي شك لا تذكر الخامة إطلاقاً/.test(VISION_PROMPT),
      "VIS-2: الخامة لا تُذكر عند الشك — لا تخمين يُقدَّم كحقيقة"
    );
    assert(
      !/اللون، الخامة، الشكل العام/.test(copySrc),
      "VIS-3: التوجيه القديم الذي يطلب الخامة صراحةً لم يعد موجوداً"
    );
    assert(
      /فاسكت عنه تماماً/.test(VISION_PROMPT),
      "VIS-4: الغموض يُسكت عنه، لا يُخمَّن ولا يُعتذر عنه"
    );
    assert(
      /ممنوع أي لغة تسويقية/.test(VISION_PROMPT) && !/مهمة للتسويق/.test(VISION_PROMPT),
      "VIS-5: مرحلة الرؤية وصف محايد — صفر لغة تسويقية"
    );
    assert(
      /٣ إلى ٥ جمل/.test(VISION_PROMPT) && /بلا حشو/.test(VISION_PROMPT),
      "VIS-6: سقف موسّع للتفاصيل المرئية مع منع الحشو"
    );
    assert(
      /askVisionDetailed\(\{ env, imageUrl, prompt \}\)/.test(copyDomainSrc) &&
        /const prompt = name \? `\$\{visionPrompt\}/.test(copyDomainSrc) &&
        /catch \(err\) \{/.test(copyDomainSrc) &&
        /const visionPrompt = visionPromptFromTaxonomy\(taxonomyBlock\)/.test(copyDomainSrc),
      "VIS-7: التوجيه مصدر واحد، وفشل الرؤية لا يكسر المسار ويُسجَّل بسببه"
    );

    // حصانة المخرَج بالمرحلة التالية.
    const withVision = buildSeoSystem({
      recent: [], keywords: ["عباية"], existingDescription: "", styleExamples: [],
      visionNotes: "عباية سوداء بقصة مستقيمة."
    });
    assert(
      /ليست مواصفات مؤكدة/.test(withVision) && /ما لم يُذكر = غير معروف/.test(withVision),
      "VIS-8: البرومبت الرئيسي يعامل ملاحظات الرؤية كمرئيات لا كمواصفات"
    );
    assert(
      /ممنوع بناء أي ادعاء جودة أو خامة/.test(withVision),
      "VIS-9: لا ادعاء خامة/جودة مبني على وصف الرؤية"
    );
    assert(
      !/ملاحظات من تحليل صورة المنتج الفعلية \(استخدميها/.test(copySrc),
      "VIS-10: الصياغة القديمة المتساهلة لكتلة الرؤية أُزيلت"
    );

    // ── الإلزام مقابل المنع (بلاغ 2026-09-08) ──────────────────────────────
    // منع الاختلاق وحده جعل النموذج يتجاهل ملاحظات الصورة كلياً فيخرج وصف
    // عام بلا لون ولا قصّة. هذي الاختبارات تثبّت الطرف الآخر من التوازن.
    assert(
      /اذكر صراحةً/.test(VISION_PROMPT) &&
        /اللون/.test(VISION_PROMPT) &&
        /القصّة\/السيلويت/.test(VISION_PROMPT),
      "VIS-11: مرحلة الرؤية تُلزم بإخراج اللون والقصّة لا مجرد منع التخمين"
    );
    assert(
      /اذكري صراحةً/.test(withVision) && /نوع القصّة\/السيلويت/.test(withVision),
      "VIS-12: كتلة الحقن تُلزم بذكر اللون والقصّة صراحةً"
    );
    assert(
      /اقتراح استخدام معقول/.test(withVision) && /مشتقاً مما يُرى فقط/.test(withVision),
      "VIS-13: اقتراح الاستخدام مطلوب ومشتق من المرئيات وحدها"
    );
    assert(
      /= نقص بالوصف، لا احتياط/.test(withVision),
      "VIS-14: الصمت عن تفصيل مرئي يُعدّ نقصاً لا احتياطاً"
    );
    assert(
      /الوصف والنبذة يجب أن يذكرا صراحةً/.test(withVision) &&
        !/الوصف والنبذة يجب أن يذكرا صراحةً/.test(
          buildSeoSystem({
            recent: [], keywords: ["عباية"], existingDescription: "",
            styleExamples: [], visionNotes: ""
          })
        ),
      "VIS-15: إلزام المخرَج النهائي يُحقن فقط حين تتوفر ملاحظات صورة"
    );
  }

  // ── اختيار نموذج الرؤية والوصف (تبديل 2026-09-08) ────────────────────
  {
    const { askVisionAI, VISION_MODEL, VISION_FALLBACK_MODEL, COPY_MODEL, TEXT_MODEL } =
      await import("../../functions/_lib/ai/gateway.js");

    assert(
      VISION_MODEL === "@cf/meta/llama-4-scout-17b-16e-instruct" &&
        COPY_MODEL === "@cf/meta/llama-4-scout-17b-16e-instruct",
      "MDL-1: الرؤية والوصف على نموذج يدعم العربية رسمياً"
    );
    assert(
      VISION_FALLBACK_MODEL === "@cf/meta/llama-3.2-11b-vision-instruct" &&
        VISION_MODEL !== VISION_FALLBACK_MODEL,
      "MDL-2: النموذج السابق يبقى احتياطياً لا أساسياً"
    );
    assert(
      TEXT_MODEL === "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      "MDL-3: نموذج المحادثة/الشخصية لم يُمَس"
    );

    const img = new Uint8Array([137, 80, 78, 71]).buffer;

    // المسار الأساسي: صيغة رسائل متعددة الأجزاء + data URI.
    let seen = null;
    const okEnv = {
      AI: {
        run: async (model, input) => {
          seen = { model, input };
          return { response: "فستان ماكسي أسود بقصّة A." };
        }
      }
    };
    const out = await askVisionAI({ env: okEnv, imageBuffer: img, prompt: "صف" });
    const part = seen.input.messages?.[0]?.content;
    assert(
      out === "فستان ماكسي أسود بقصّة A." && seen.model === "@cf/qwen/qwen3.8-27b" &&
        Array.isArray(part) && part[0].type === "text" && part[0].text === "صف" &&
        part[1].type === "image_url" && /^data:image\/jpeg;base64,/.test(part[1].image_url.url),
      "MDL-4: الرؤية تستدعي نموذج التفاصيل بصيغة أجزاء + data URI"
    );
    assert(
      seen.input.chat_template_kwargs?.enable_thinking === false,
      "MDL-4b: التفكير معطّل لنماذج الرؤية الاستدلالية (Qwen/Gemma) كي لا يعود نص فارغ"
    );

    // فشل الأساسي (نموذج غير متاح أو صيغة تغيّرت) لا يُسقط الميزة.
    const calls = [];
    const failEnv = {
      AI: {
        run: async (model, input) => {
          calls.push(model);
          if (model === VISION_MODEL || model === "@cf/qwen/qwen3.8-27b" || model === "@cf/google/gemma-4-26b-a4b-it") throw new Error("model unavailable");
          return { response: "وصف من الاحتياطي" };
        }
      }
    };
    const fb = await askVisionAI({ env: failEnv, imageBuffer: img, prompt: "صف" });
    assert(
      fb === "وصف من الاحتياطي" && calls[0] === "@cf/qwen/qwen3.8-27b" && calls[1] === "@cf/google/gemma-4-26b-a4b-it" && calls[2] === VISION_MODEL && calls[3] === VISION_FALLBACK_MODEL,
      "MDL-5: فشل الأساسي يسقط للاحتياطي بدل إسقاط الميزة"
    );

    // مخرج فارغ من الأساسي يُعامَل فشلاً — لا وصف فارغ يمر للتاجر.
    const emptyEnv = {
      AI: {
        run: async (model) =>
          model === VISION_MODEL ? { response: "   " } : { response: "احتياطي" }
      }
    };
    assert(
      (await askVisionAI({ env: emptyEnv, imageBuffer: img, prompt: "صف" })) === "احتياطي",
      "MDL-6: مخرج فارغ من الأساسي يسقط للاحتياطي"
    );

    // صيغة متوافقة مع OpenAI تُقرأ أيضاً (لا اعتماد على شكل واحد).
    const oaEnv = {
      AI: { run: async () => ({ choices: [{ message: { content: "وصف OpenAI-style" } }] }) }
    };
    assert(
      (await askVisionAI({ env: oaEnv, imageBuffer: img, prompt: "صف" })) === "وصف OpenAI-style",
      "MDL-7: قارئ المخرج يفهم صيغة choices[] كما يفهم response"
    );

    // صورة كبيرة: التحويل لـbase64 لا ينفجر بتجاوز مكدس الوسائط.
    const bigEnv = { AI: { run: async () => ({ response: "ok" }) } };
    const big = new Uint8Array(300000).buffer;
    assert(
      (await askVisionAI({ env: bigEnv, imageBuffer: big, prompt: "صف" })) === "ok",
      "MDL-8: صورة ٣٠٠ كيلوبايت تُرمَّز بلا تجاوز مكدس"
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

  // ── N2-fix — جلب الصورة كان يفشل ١٠٠٪ بلا أن يراه أحد (2026-09-09) ──
  {
    const { fetchExternalImage } = await import("../../functions/_lib/core/security.js");
    const realFetch = globalThis.fetch;
    const seen = [];
    try {
      // Workers لا تنفّذ redirect:"error" وترمي قبل أي طلب — فلا يُطلب أبداً.
      globalThis.fetch = async (u, init) => {
        seen.push(init?.redirect);
        if (init?.redirect === "error") throw new Error("Invalid redirect value, must be one of \"follow\" or \"manual\"");
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
      };
      const out = await fetchExternalImage("https://cdn.example.com/a.jpg");
      assert(
        seen[0] === "manual" && out.buffer.byteLength === 3,
        `N2-1: الجلب يستخدم redirect:"manual" لا "error" (المستخدم: ${seen[0]})`
      );

      // الحماية الأصلية باقية: تحويل ٣xx يُرفض صراحةً.
      globalThis.fetch = async () => new Response("", { status: 302, headers: { location: "http://169.254.169.254/" } });
      let blocked = false;
      try { await fetchExternalImage("https://cdn.example.com/b.jpg"); } catch { blocked = true; }
      assert(blocked, "N2-2: التحويل ٣xx ما زال مرفوضاً — لا التفاف على فحص المضيف");

      // ومضيف داخلي يبقى مرفوضاً قبل أي طلب.
      let host = false;
      try { await fetchExternalImage("https://169.254.169.254/x.jpg"); } catch { host = true; }
      assert(host, "N2-3: IP مباشر مرفوض قبل الطلب");
    } finally {
      globalThis.fetch = realFetch;
    }
  }

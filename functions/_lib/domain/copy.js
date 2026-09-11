// مجال النسخ التسويقي: توليد وصف المنتج والـSEO كاملاً، وسجل ما وُلّد سابقاً
// لمنع التكرار. مُنقول من `core/db.js` (المرحلة ٣) ومن `api/copy.js`
// (المرحلة ٤ — ARCHITECTURE §٢) بلا تغيير سلوكي.
import { askWorkersAI, COPY_MODEL } from "../ai/gateway.js";
import { askVisionDetailed } from "../ai/vision.js";
import { buildSeoSystem, visionPromptFromTaxonomy } from "../ai/prompts/seo.js";
import { recallStyleExamples } from "../ai/memory.js";
import { fenceUntrusted, UNTRUSTED_DATA_NOTICE } from "../ai/guards.js";
import { getProfile, profileToPromptBlock } from "./storeProfile.js";
import { taxonomyForProduct } from "../ai/productTaxonomy.js";
import { logError } from "../core/errorLog.js";
import { CopyParseError, parseSeoResponse, classifyVisionNotes, descriptionQualityIssues, cleanDescription, publishedFieldIssues, cleanPublishedFields, splitSentences, propItemIn } from "./copyParse.js";
import { categoryMismatch } from "../ai/productType.js";

// نافذة recentCopy مثبّتة على ٥ (docs/PLAN_BULK_SEO.md §٥، المخاطرة ٣):
// الدالة تجلب "الأخيرة" فقط، فعبر دفعة ٢٠٠ منتج تنجرف — منتج ٢٠٠ يقارن نفسه
// بمنتج ١٩٥ لا بمنتج ١. تثبيت النافذة يبقيها أداة "لا تكرري نفس الافتتاحية"
// ولا يسمح لها بأن تصير مرجع الأسلوب؛ المرجع هو بصمة المتجر أدناه.
const RECENT_OPENINGS_WINDOW = 5;

export const TONE_LABELS = {
  white: "لهجة بيضاء تسويقية ودودة",
  formal: "فصحى رسمية راقية",
  luxury: "فخامة وحصرية",
  deals: "حماس عروض بدون إلحاح كاذب",
  funny: "خفة دم سعودية لطيفة"
};

/**
 * A8 — الكلمات المستهدفة = **الاسم كاملاً + الفئة + ما أدخله التاجر**، لا أكثر.
 *
 * كان الاسم يُفكَّك لكلمات مفردة (`split(/\s+/)`)، فمنتج اسمه "عباية سوداء
 * بقصّة A" يُنتج «عباية»، «سوداء»، «بقصّة» ككلمات مفتاحية مستقلة. «سوداء»
 * وحدها ليست كلمة بحث، و«بقصّة» ليست كلمة إطلاقاً — ثم يُطلب من النموذج
 * حشوها بالنص. النتيجة حشو بلا قيمة SEO وضد القاعدة ٥ بالبرومبت نفسه.
 */
export function seedKeywords(name, category, extra) {
  const base = new Set();
  (extra || []).forEach((k) => k && base.add(String(k).trim()));
  const fullName = String(name || "").trim();
  if (fullName) base.add(fullName);
  if (category) base.add(String(category).trim());
  return [...base].filter(Boolean).slice(0, 6);
}
/**
 * البوابة الوحيدة لحقن البصمة — دالة مصدَّرة عمداً لتكون **مُختبَرة مباشرة**:
 * الفرق بين `draft` و`approved` هنا هو كل ما يفصل "الإنسان قرر" عن "النموذج
 * قرر نيابة عنه" عبر دفعة كاملة. مسودة، أو غياب بصمة، أو صف تالف ⇒ "" ⇒
 * السلوك القديم بلا أي تغيير.
 */
export function approvedProfileBlock(profileRow) {
  return profileRow?.status === "approved" ? profileToPromptBlock(profileRow.profile) : "";
}
// المرحلة ٦: لم تعد مصدَّرة — كان الـshim `core/db.js` (المحذوف) يعيد تصديرها
// بلا مستورد واحد. تُستخدم داخل هذا الملف فقط؛ لا سطح تعديل زائف (لا كود ميت).
async function recentCopy(env, merchantId, limit = 8) {
  if (!env.DB) return [];
  const { results } = await env.DB.prepare(
    "SELECT product_name, opening, keywords FROM copy_history WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?"
  )
    .bind(merchantId, limit)
    .all();
  return results || [];
}

// المرحلة ٦: لم تعد مصدَّرة — كان الـshim `core/db.js` (المحذوف) يعيد تصديرها
// بلا مستورد واحد. تُستخدم داخل هذا الملف فقط؛ لا سطح تعديل زائف (لا كود ميت).
async function saveCopy(env, { merchantId, productName, opening, keywords }) {
  if (!env.DB) return;
  await env.DB.prepare(
    "INSERT INTO copy_history (merchant_id, product_name, opening, keywords) VALUES (?, ?, ?, ?)"
  )
    .bind(merchantId, productName || null, (opening || "").slice(0, 80), (keywords || []).join(", "))
    .run();
}

// Core generation, no HTTP/quota concerns — used by the interactive endpoint
// below AND by cron/bulk_process.js (B3), which calls this directly instead
// of self-fetching over HTTP to avoid an extra round-trip per product in a
// job that's already rate-limited to ~1/sec by Salla.
// جمل عن العارضة أو عن قطعة غير المنتج تُحذف من ملاحظات الصورة **قبل** الكاتب. السجل الحي
// (2026-09-11، بلوزة متجر المراجعة) أثبت أن النموذج أصرّ على «التنورة…» عبر ثلاث محاولات
// لأن الملاحظات نفسها تصفها — الحارس بعد الكتابة كان يحذف، والمصدر يعيد الإغراء كل مرة.
// ووضعية العارضة أيضاً: «اليد اليمنى في الجيب» وصل وصف بلوزة حقيقي (2026-09-11 22:42 UTC).
const MODEL_PERSON = /(العارضة|عارضة الأزياء|(?<!\p{L})(?:اليد|يدها|يديها|اليدين|ذراعها|تقف|واقفة|وضعية|شعرها|وجهها|الخلفية)(?!\p{L})|(?<!\p{L})model(?!\p{L})|wearing|paired with|pocket|background)/iu;
function productOnlyNotes(notes, name) {
  return splitSentences(notes).filter((s) => !MODEL_PERSON.test(s) && !propItemIn(s, name)).join(" ").trim();
}
const descWords = (p) => String(p?.copywriting?.description || "").split(/\s+/).filter(Boolean).length;

/**
 * كاتب وصف مركّز: نداء قصير مستقل لحقل الوصف وحده، نصاً عادياً.
 *
 * السجل الحي (بلوزة متجر المراجعة، ثلاثة توليدات) أثبت أن إعادة المحاولة بنفس البرومبت
 * الضخم — الشخصية، ١٢ قاعدة، الأمثلة، المعجم، ١٥ حقل JSON — تُرجع نفس الوصف القصير حرفياً
 * كل مرة. النموذج يحمل تعليمات أكثر مما يلتزم به. هنا مهمة واحدة ببرومبت قصير.
 */
function focusedDescriptionSystem(name, notes, variantsText) {
  return [
    "أنتِ كاتبة أوصاف منتجات لمتاجر سعودية بالعربية البيضاء.",
    `اكتبي وصف «${name}» فقط، نصاً عادياً بلا JSON وبلا عناوين وبلا علامات تنصيص.`,
    "الطول: من ٦٠ إلى ٩٠ كلمة في ثلاث فقرات قصيرة يفصل بينها سطر فارغ:",
    `١) ابدئي بكلمة «${name}» ثم صفي ما في ملاحظات الصورة بالتفصيل: اللون، القصّة، الياقة، الأكمام، الطول، وكل تفصيل ورد فيها.`,
    "٢) متى وكيف تُلبس، مع قطعة تنسيق مقترحة.",
    "الطول والقصّة بكلمة الملاحظات نفسها («ميدي» تبقى «ميدي»)، لا «طويل» ولا «قصير» ولا «كلوش» ولا «واسع» ما لم تَرِد فيها.",
    "٣) جملة واحدة بهذه الصيغة أو قريبة منها: «راجعي جدول المقاسات قبل الطلب لاختيار المقاس المناسب.» — فعل أمر موجّه للعميلة، لا «توصي» ولا «يرجى» بلا فاعل.",
    "ممنوع: السعر، الشحن والإرجاع والدفع، أي خامة لم ترد، أحكام الجودة (مريح، أنيق، أناقة، فاخر، فخامة، مثالي، راقٍ)، ذكر العارضة أو الصورة، وأي تفصيل لم يرد بالملاحظات.",
    variantsText ? `الخيارات المتوفرة فعلاً: ${variantsText}` : "",
    UNTRUSTED_DATA_NOTICE,
    fenceUntrusted("ملاحظات الصورة", notes, 1500)
  ].filter(Boolean).join("\n");
}

/** مخرج الكاتب المركّز نصاً؛ لو أعاد JSON رغم التعليمة نأخذ حقل الوصف منه. */
function readFocusedText(raw) {
  let text = String(raw || "").trim().replace(/^["«]|["»]$/g, "").trim();
  if (/^[{[]/.test(text)) {
    try {
      const j = JSON.parse(text);
      text = String(j?.copywriting?.description || j?.description || "");
    } catch {
      text = "";
    }
  }
  return text.trim();
}

export async function generateProductCopy({ env, merchantId, name, price, tone, category, features, existingDescription, imageUrl, variants, keywordsExtra }) {
  const keywords = seedKeywords(name, category, keywordsExtra);
  const recent = await recentCopy(env, merchantId, RECENT_OPENINGS_WINDOW).catch(() => []);

  // بصمة المتجر: **المعتمَدة فقط**. مسودة (`draft`) لم يوافق عليها التاجر لا
  // تُحقن إطلاقاً — بصمة اخترعها نموذج ثم طُبّقت على ٢٠٠ منتج بلا قرار إنسان
  // هي أوسع انتهاك ممكن لمبدأ "الـAI يقترح والإنسان يقرر".
  // الـcatch مقصود ولازم: جدول store_profiles قد لا يكون مطبَّقاً بعد
  // (migrations/0019 مكتوبة وغير مطبَّقة) — غيابه يجب أن يُبقي السلوك القديم
  // كما هو حرفياً، لا أن يُسقط توليد المحتوى.
  const profileRow = await getProfile(env, { merchantId }).catch(() => null);
  const profileBlock = approvedProfileBlock(profileRow);

  // كتيب مصطلحات الفئة: يوجّه التسمية بمرحلة الرؤية، ثم يُلزم الوصف النهائي
  // بنفس المصطلحات. فئة غير مغطاة ⇒ "" ⇒ لا فرق عن السلوك القديم.
  // الفئة أولاً، ثم اسم المنتج احتياطاً: فئة المتجر بيانات تاجر قد تكون
  // خاطئة (رُصد "فستان" مصنَّفاً تحت "البلايز" — فسقط الكتيب كله بصمت).
  // الخيارات تصل نصاً JSON من الكتالوج — تحليل متساهل: صف تالف لا يُسقط التوليد.
  let parsedVariants = [];
  if (variants) {
    try {
      parsedVariants = typeof variants === "string" ? JSON.parse(variants) : variants;
      if (!Array.isArray(parsedVariants)) parsedVariants = [];
    } catch { parsedVariants = []; }
  }

  const taxonomyBlock = taxonomyForProduct({ category, name });
  const visionPrompt = visionPromptFromTaxonomy(taxonomyBlock);
  // فشل الرؤية كان يُبلع بـ`.catch(() => null)` بلا سطر واحد بالسجل — فحين
  // طلع وصف مفبرك على متجر حي لم يكن بالسجل ما يفسّره. الآن يُسجَّل السبب
  // الحقيقي (أي نموذج فشل وبأي رسالة) بلا أن يُسقط التوليد.
  let rawVisionNotes = null;
  let visionModel = null;
  let visionErrors = "";
  if (imageUrl) {
    try {
      const out = await askVisionDetailed({ env, imageUrl, prompt: visionPrompt });
      rawVisionNotes = out.text || null;
      visionModel = out.model;
      visionErrors = (out.errors || []).join(" | ").replace(/\s+/g, " ").slice(0, 300);
      if (!out.text) {
        logError({ env }, {
          requestId: null,
          path: "api/copy:vision",
          code: "VISION_EMPTY",
          internal: (out.errors || []).join(" | ").slice(0, 300) || "no text from any vision model",
          storeId: merchantId
        });
      }
    } catch (err) {
      logError({ env }, {
        requestId: null,
        path: "api/copy:vision",
        code: "VISION_FAILED",
        internal: String(err?.message || err).slice(0, 300),
        storeId: merchantId
      });
    }
  }

  // A5 — النموذج الاحتياطي للرؤية (`llama-3.2-11b-vision`) **إنجليزي فقط مع
  // الصور** ببطاقة ميتا نفسها. حين يُستخدم تعود الملاحظات بالإنجليزية، ثم كان
  // البرومبت يُلزم الوصف العربي بـ"ذكر كل تفصيل ورد بهذي الملاحظات صراحةً" —
  // فيقحم النموذج مصطلحات إنجليزية بوصف منتج عربي، أو يترجمها تخميناً. مخرج
  // بلا حرف عربي واحد يُهمل بالكامل ويُسجَّل، ويُبنى الوصف من النص وحده.
  // الملاحظات الإنجليزية تُستخدم ولا تُهدر — إهدارها ترك النموذج بلا حقائق
  // فاخترع خامة وجودة على منتج لم يره. اللغة تُعالَج بالبرومبت لا بالحذف.
  const classified = classifyVisionNotes(rawVisionNotes);
  const visionNotes = productOnlyNotes(classified?.text || "", name);
  const visionLanguage = classified?.language || null;
  if (classified?.language === "en") {
    logError({ env }, {
      requestId: null,
      path: "api/copy:vision",
      code: "VISION_NOTES_ENGLISH",
      internal: `model=${visionModel || "?"} — notes returned in English; translated by the copy prompt`,
      storeId: merchantId
    });
  }

  const styleExamples = category
    ? await recallStyleExamples({ env, category, productContext: `${name} ${features}`.trim(), topK: 3 }).catch(() => [])
    : [];

  const system = buildSeoSystem({ recent, keywords, existingDescription, visionNotes, visionLanguage, variants: parsedVariants, styleExamples, profileBlock, taxonomyBlock, productName: name });
  const toneLabel = TONE_LABELS[tone] || TONE_LABELS.white;
  // السعر لا يُمرَّر للنموذج (2026-09-11): كان يعود داخل نص الوصف («السعر: 83
  // ريال») فيتقادم مع أول تعديل سعر بالمتجر. يبقى لـJSON-LD فقط عبر parseSeoResponse.
  const userMsg = `اسم المنتج: ${name}\nالفئة: ${category || "غير محددة"}\nمزايا: ${features || "لا يوجد"}\nالنبرة: ${toneLabel} (${tone})`;

  const ask = (extraSystem, skipCache) =>
    askWorkersAI({
      env,
      system: `${system}${extraSystem}`,
      messages: [{ role: "user", content: userMsg }],
      maxTokens: 1200,
      // 0.35 لا 0.7: عيّنة أعلى أنتجت كلمة مكسورة («وستثنينية») على منتج حقيقي.
      temperature: 0.35,
      model: COPY_MODEL,
      storeId: merchantId, // scopes the KV cache — two merchants selling the same product name must not share copy
      ttlKind: "copy",
      skipCache
    });

  let parsed;
  try {
    parsed = parseSeoResponse(await ask("", false), name, price);
  } catch (err) {
    if (!(err instanceof CopyParseError)) throw err;
    // A4 — إعادة محاولة **واحدة** بتعليمة صارمة، وبتجاوز الكاش (وإلا أعاد
    // الطبقةُ نفسَ المخرج التالف). فشلها ⇒ خطأ مصنَّف، لا وصف خام يُنشر.
    logError({ env }, {
      requestId: null,
      path: "api/copy:parse",
      code: "COPY_PARSE_RETRY",
      internal: "first model output unparseable — retrying with JSON-only instruction",
      storeId: merchantId
    });
    const strict =
      "\n\n## تنبيه إخراج صارم\nأرجعي **JSON صالحاً فقط** يبدأ بـ{ وينتهي بـ}. بلا أي نص قبله أو بعده، بلا شرح، بلا أسوار كود (```)، بلا اعتذار.";
    parsed = parseSeoResponse(await ask(strict, true), name, price);
  }
  // بوابة جودة حتمية بعد التحليل: افتتاحية إشارية / سعر بالنثر / قصر رغم صورة.
  // إعادة محاولة واحدة بتعليمة تسمّي العيب وبتجاوز الكاش، ثم تنظيف مضمون.
  const hasVision = Boolean(visionNotes);
  // مصدر الخامات = بيانات التاجر وحدها. ملاحظات الصورة **ليست** مصدراً: الصورة
  // لا تثبت ذهباً ولا حريراً (قاعدة المعرفة السعودية F005/F006).
  const sourceText = [name, features, existingDescription, JSON.stringify(parsedVariants)].join(" ");
  // الحارس على كل ما يُنشر، لا الوصف وحده: النقاط والأسئلة الشائعة والعنوان والميتا
  // تُنشر مع الوصف على صفحة المنتج (sallaProductPayload.js).
  const allIssues = (p) => [...descriptionQualityIssues(p.copywriting, { hasVision, sourceText, productName: name }), ...publishedFieldIssues(p, { sourceText, productName: name })];
  let issues = allIssues(parsed);
  if (issues.length) {
    logError({ env }, {
      requestId: null, path: "api/copy:quality", code: "COPY_QUALITY_RETRY",
      internal: issues.map((i) => i.code).join(","), storeId: merchantId
    });
    const strictQuality = "\n\n## إعادة كتابة مطلوبة — عيوب بالمخرج السابق\n" + issues.map((i) => `- ${i.text}`).join("\n");
    try {
      const again = parseSeoResponse(await ask(strictQuality, true), name, price);
      const againIssues = allIssues(again);
      if (againIssues.length < issues.length) { parsed = again; issues = againIssues; }
    } catch (err) {
      if (!(err instanceof CopyParseError)) throw err; // المخرج الأول صالح — نبقيه
    }
  }
  // القِصَر لا يُصلحه التنظيف (حذف فقط). الوصف القصير مع صورة يُعاد بكاتب مركّز مستقل
  // (نداء واحد) بدل تكرار البرومبت الضخم الذي أعاد نفس النص حرفياً ثلاث مرات.
  if (issues.some((i) => i.code === "TOO_SHORT")) {
    // الملاحظات (مقتطف) وعدد الكلمات تُحفظ بالسجل: البث الحي انقطع مرتين، والتشخيص يحتاجها.
    const diag = `${issues.map((i) => i.code).join(",")} words=${descWords(parsed)} vision=${visionModel || "none"} verr=${visionErrors || "-"} notes=${visionNotes.slice(0, 300).replace(/\s+/g, " ")}`;
    logError({ env }, { requestId: null, path: "api/copy:quality", code: "COPY_LENGTH_RETRY", internal: diag, storeId: merchantId });
    try {
      const variantsText = parsedVariants.map((v) => `${v.name}: ${(v.values || []).join("، ")}`).join(" · ");
      const raw = await askWorkersAI({
        env,
        system: focusedDescriptionSystem(name, visionNotes, variantsText),
        messages: [{ role: "user", content: `اكتبي وصف «${name}» الآن.` }],
        maxTokens: 500,
        temperature: 0.4,
        model: COPY_MODEL,
        storeId: merchantId,
        ttlKind: "copy",
        skipCache: true
      });
      // يُنظَّف قبل التقييم: النص المقبول هو نفسه ما يُنشر، لا نسخة يقصّها التنظيف لاحقاً.
      const rawText = readFocusedText(raw);
      const text = cleanDescription(rawText, { sourceText, productName: name });
      const candidate = { ...parsed, copywriting: { ...parsed.copywriting, description: text } };
      const candidateIssues = allIssues(candidate);
      const wc = (s) => String(s || "").split(/\s+/).filter(Boolean).length;
      // أطول من الحالي بعد تنظيفه وليس أسوأ بالعيوب ⇒ يُقبل ولو بقي تحت حد الطول. رُفض نص بـ٣٣ كلمة
      // وثلاث فقرات، فنُشر بدله ٢٧ كلمة بفقرة واحدة بلا تنسيق ولا جدول مقاسات (2026-09-11 23:50).
      const longer = wc(text) > wc(cleanDescription(parsed.copywriting.description, { sourceText, productName: name }));
      const accepted = Boolean(text) && candidateIssues.length <= issues.length && (longer || !candidateIssues.some((i) => i.code === "TOO_SHORT"));
      logError({ env }, { requestId: null, path: "api/copy:quality", code: "COPY_FOCUSED_RESULT", internal: `accepted=${accepted} raw=${wc(rawText)} words=${wc(text)} ${candidateIssues.map((i) => i.code).join(",")}`, storeId: merchantId });
      if (accepted) {
        parsed = candidate;
        issues = candidateIssues;
      }
    } catch (err) {
      logError({ env }, { requestId: null, path: "api/copy:quality", code: "COPY_FOCUSED_FAILED", internal: String(err?.message || err).slice(0, 200), storeId: merchantId });
    }
  }
  if (issues.length) {
    // النموذج أصرّ: تنظيف حتمي (حذف فقط، لا اختراع) ويُسجَّل أنه قُسر.
    parsed.copywriting.description = cleanDescription(parsed.copywriting.description, { sourceText, productName: name });
    parsed.copywriting.excerpt = cleanDescription(parsed.copywriting.excerpt, { sourceText, productName: name }).slice(0, 250);
    parsed.copywriting.whatsapp = cleanDescription(parsed.copywriting.whatsapp, { sourceText, productName: name });
    cleanPublishedFields(parsed, { sourceText, name });
    logError({ env }, {
      requestId: null, path: "api/copy:quality", code: "COPY_QUALITY_FORCED",
      internal: `${issues.map((i) => i.code).join(",")} words=${descWords(parsed)}`, storeId: merchantId
    });
  }
  await saveCopy(env, { merchantId, productName: name, opening: parsed.copywriting.description, keywords }).catch(() => {});
  parsed.usedImage = Boolean(visionNotes);
  // تصنيف المتجر بيانات تاجر قد تكون خاطئة — رُصد فستان تحت «التنانير». حين
  // ترى هالة نوعاً يخالف التصنيف المسجَّل، **تقترح** التصحيح ولا تنفّذه:
  // تغيير تصنيف منتج على متجر حي بلا موافقة التاجر تصرّف بمتجره لا مساعدة.
  parsed.categoryMismatch = categoryMismatch({ visionNotes, name, category });
  return parsed;
}

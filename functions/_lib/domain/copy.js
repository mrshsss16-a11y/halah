// مجال النسخ التسويقي: توليد وصف المنتج والـSEO كاملاً، وسجل ما وُلّد سابقاً
// لمنع التكرار. مُنقول من `core/db.js` (المرحلة ٣) ومن `api/copy.js`
// (المرحلة ٤ — ARCHITECTURE §٢) بلا تغيير سلوكي.
import { askWorkersAI, askVisionAI, COPY_MODEL } from "../ai/gateway.js";
import { buildSeoSystem, visionPromptFromTaxonomy } from "../ai/prompts/seo.js";
import { recallStyleExamples } from "../ai/memory.js";
import { getProfile, profileToPromptBlock } from "./storeProfile.js";
import { taxonomyForProduct } from "../ai/productTaxonomy.js";
import { logError } from "../core/errorLog.js";
import { CopyParseError, parseSeoResponse, acceptArabicVisionNotes } from "./copyParse.js";

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
export async function recentCopy(env, merchantId, limit = 8) {
  if (!env.DB) return [];
  const { results } = await env.DB.prepare(
    "SELECT product_name, opening, keywords FROM copy_history WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?"
  )
    .bind(merchantId, limit)
    .all();
  return results || [];
}

export async function saveCopy(env, { merchantId, productName, opening, keywords }) {
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
export async function generateProductCopy({ env, merchantId, name, price, tone, category, features, existingDescription, imageUrl, keywordsExtra }) {
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
  const taxonomyBlock = taxonomyForProduct({ category, name });
  const visionPrompt = visionPromptFromTaxonomy(taxonomyBlock);
  const rawVisionNotes = imageUrl
    ? await askVisionAI({ env, imageUrl, prompt: visionPrompt }).catch(() => null)
    : null;

  // A5 — النموذج الاحتياطي للرؤية (`llama-3.2-11b-vision`) **إنجليزي فقط مع
  // الصور** ببطاقة ميتا نفسها. حين يُستخدم تعود الملاحظات بالإنجليزية، ثم كان
  // البرومبت يُلزم الوصف العربي بـ"ذكر كل تفصيل ورد بهذي الملاحظات صراحةً" —
  // فيقحم النموذج مصطلحات إنجليزية بوصف منتج عربي، أو يترجمها تخميناً. مخرج
  // بلا حرف عربي واحد يُهمل بالكامل ويُسجَّل، ويُبنى الوصف من النص وحده.
  const visionNotes = acceptArabicVisionNotes(rawVisionNotes);
  if (rawVisionNotes && !visionNotes) {
    logError({ env }, {
      requestId: null,
      path: "api/copy:vision",
      code: "VISION_FALLBACK_DISCARDED",
      internal: "vision notes contained no Arabic script — English fallback model output discarded",
      storeId: merchantId
    });
  }

  const styleExamples = category
    ? await recallStyleExamples({ env, category, productContext: `${name} ${features}`.trim(), topK: 3 }).catch(() => [])
    : [];

  const system = buildSeoSystem({ recent, keywords, existingDescription, visionNotes, styleExamples, profileBlock, taxonomyBlock });
  const toneLabel = TONE_LABELS[tone] || TONE_LABELS.white;
  const userMsg = `اسم المنتج: ${name}\nالسعر: ${price || "غير محدد"} ريال\nالفئة: ${category || "غير محددة"}\nمزايا: ${features || "لا يوجد"}\nالنبرة: ${toneLabel} (${tone})`;

  const ask = (extraSystem, skipCache) =>
    askWorkersAI({
      env,
      system: `${system}${extraSystem}`,
      messages: [{ role: "user", content: userMsg }],
      maxTokens: 1200,
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
  await saveCopy(env, { merchantId, productName: name, opening: parsed.copywriting.description, keywords }).catch(() => {});
  parsed.usedImage = Boolean(visionNotes);
  return parsed;
}

// ذاكرة RAG على Vectorize — الواجهة المجالية فوق `vectorStore.js`.
//
// هذا الملف كان يلمس `env.VECTORIZE_INDEX` مباشرة بستة مواضع بشكل metadata
// مختلف لكل واحد، وبلا أي سجل يسمح بالحذف. صار كله يمرّ بالمالك الوحيد
// (`vectorStore.js`): شكل موحَّد `{storeId, kind, text, refId, ts}`، عزل
// إلزامي بالـstoreId، وسجل `vector_refs` يجعل المحو النهائي ممكناً فعلاً.
import { upsertVector, queryVectors, deleteVectorIds, vectorIdFor } from "./vectorStore.js";

/**
 * نص المقتطف المسترجع كما يدخل البرومبت.
 *
 * الباغ الذي يغلقه: برومبتات الاسترجاع الثلاثة (`prompts/support.js`،
 * `prompts/chat.js`، `domain/whatsappAutoReply.js`) كانت تبني `m.question` و
 * `m.reply` دائماً، بينما متجهات التاجر تحمل `{text}` فقط — فكل مقتطف تاجر
 * كان يصل النموذج بالنص الحرفي «س: undefined ج: undefined». الآن: النص إن
 * وُجد، وإلا الشكل القديم (متجهات أورا المخزَّنة سلفاً بالمؤشر الحي ما زالت
 * تحمل question/reply حتى تُعاد فهرستها)، وإلا يُسقَط المقتطف بلا ضجيج.
 * @returns {string} نص جاهز للبرومبت، أو "" لمقتطف بلا محتوى.
 */
export function formatMemory(m) {
  const text = String(m?.text ?? "").trim();
  if (text) return text;
  const question = String(m?.question ?? "").trim();
  const reply = String(m?.reply ?? "").trim();
  if (!question && !reply) return "";
  return `س: ${question}\nج: ${reply}`;
}

export async function storeVectorMemory({ env, storeId, text, metadata = {} }) {
  return upsertVector(env, {
    storeId,
    kind: metadata.kind || "memory",
    text,
    refId: metadata.faqId ?? metadata.refId ?? ""
  });
}

export async function recallSimilar({ env, storeId, question, topK = 5 }) {
  return queryVectors(env, { storeId, text: question, topK });
}

// ── أسئلة التاجر الشائعة: معرّف حتمي ──────────────────────────────────────────
// قبل هذا، كل حفظ فوق نفس `faqId` كان يُنتج متجهاً **إضافياً** (معرّف عشوائي مع
// `insert`)، فالسؤال المعدَّل يبقى بنسخته القديمة بالذاكرة إلى الأبد، والحذف من
// D1 لا يزيل متجهه إطلاقاً. المعرّف الحتمي يجعل الحفظ استبدالاً والحذف ممكناً.
const MERCHANT_FAQ_KIND = "merchant_faq";

function merchantFaqVectorId(merchantId, faqId) {
  return vectorIdFor(MERCHANT_FAQ_KIND, merchantId, faqId);
}

export async function storeMerchantFaqVector({ env, merchantId, faqId, question, answer }) {
  if (!faqId) return null;
  return upsertVector(env, {
    storeId: merchantId,
    kind: MERCHANT_FAQ_KIND,
    text: `س: ${question}\nج: ${answer}`,
    refId: String(faqId),
    id: merchantFaqVectorId(merchantId, faqId)
  });
}

export async function deleteMerchantFaqVector({ env, merchantId, faqId }) {
  if (!faqId) return 0;
  return deleteVectorIds(env, { storeId: merchantId, ids: [merchantFaqVectorId(merchantId, faqId)] });
}

/**
 * يعيد تضمين كل صف بـ`hala_faq` تحت storeId="hala". المعرّفات حتمية
 * (`hala_faq:hala:<id>`) فإعادة التشغيل استبدال بمكانه، لا تراكم.
 */
const HALA_STORE_ID = "hala";
const HALA_FAQ_KIND = "hala_faq";
// المعرّف يبقى بصيغته القديمة `hala_faq_<id>` عمداً: المؤشر الحي يحمل متجهات
// بهذه الصيغة الآن، وتغييرها يجعل كل واحد منها يتيماً لا يُستبدَل ولا يُحذف —
// فيظهر جواب قديم بجانب الجديد. الاستبدال بمكانه أهم من اتساق شكل المعرّف.
const halaFaqVectorId = (id) => `hala_faq_${id}`;

export async function reembedHalaFaq(env, faqRows) {
  if (!env?.VECTORIZE_INDEX) return 0;
  let count = 0;
  for (const row of faqRows) {
    await upsertVector(env, {
      storeId: HALA_STORE_ID,
      kind: HALA_FAQ_KIND,
      text: `س: ${row.question}\nج: ${row.answer}`,
      refId: String(row.id),
      id: halaFaqVectorId(row.id)
    });
    count++;
  }
  return count;
}

/**
 * يزيل متجه صف hala_faq محذوف حتى يتوقف الاسترجاع عن عرض جواب لم يعد موجوداً
 * بـD1. لازم لأن `reembedHalaFaq` يستبدل الحاضر ولا يقلّم الغائب.
 */
export async function deleteHalaFaqEmbedding(env, id) {
  await deleteVectorIds(env, { storeId: HALA_STORE_ID, ids: [halaFaqVectorId(id)] });
}

// ── مكتبة الأسلوب: أوصاف منتجات حقيقية ناجحة، عابرة للتجار ──────────────────
// ليست ذاكرة متجر: مرجع لـ«كيف يُكتب وصف جيد» بفئة معيّنة (عبايات، عطور…)
// يوجّه نبرة وبنية `copy.js`. تعيش بنفس المؤشر تحت معرّف متجر وهمي ثابت فلا
// تختلط أبداً بذاكرة تاجر حقيقي (معرّفات التجار "m_..." أو "hala").
const STYLE_LIBRARY_STORE_ID = "style_library";

export async function storeStyleExample({ env, category, text, note, refKey = null }) {
  if (!category || !text) return null;
  return upsertVector(env, {
    storeId: STYLE_LIBRARY_STORE_ID,
    kind: "style_example",
    // مفتاح المصدر (مثل P001 بمكتبة الأوصاف السعودية) ⇒ معرّف متجه ثابت، فإعادة
    // الزرع بعد تنقيح تستبدل الصف ولا تكرره. بلا مفتاح يبقى السلوك القديم (عشوائي).
    id: refKey ? vectorIdFor("style_example", STYLE_LIBRARY_STORE_ID, String(refKey)) : null,
    // الملاحظة جزء من نص المثال: لا حقل خاص بها بالشكل الموحَّد، وإسقاطها
    // صامتاً يفقد سبب اختيار المثال.
    text: note ? `${text}\n\n(ملاحظة: ${note})` : String(text),
    refId: String(category)
  });
}

/**
 * أقرب أمثلة حقيقية لفئة+اسم+مزايا المنتج الحالي. عمداً **بلا** مطابقة فئة
 * حرفية: فئة التاجر الحرة ("عطور رجالية") نادراً تطابق تسمية المكتبة ("عطور")،
 * فالتشابه الدلالي عبر المكتبة كلها (وهي معزولة بمعرّفها الوهمي) هو المطابِق.
 */
export async function recallStyleExamples({ env, category, productContext, topK = 3 }) {
  if (!category) return [];
  return queryVectors(env, {
    storeId: STYLE_LIBRARY_STORE_ID,
    text: `${category} ${productContext || ""}`.trim(),
    topK,
    // المكتبة مرجع أسلوب لا إجابة: عتبة الذاكرة تُفرغها من أقرب مثال متاح
    // بفئة لم تُغطَّ بعد، وذلك أسوأ من مثال بعيد نسبياً يُستلهم منه الشكل.
    minScore: 0
  });
}

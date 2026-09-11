// المالك الوحيد لربط Vectorize (`env.VECTORIZE_INDEX`) — 2026-09-11.
//
// لماذا وُجد هذا الملف: ثلاث مشاكل حقيقية وُلدت من تفرّق النداءات على الربط:
//
//  ١. **«الحذف نهائي» كان ادعاءً غير صحيح للذاكرة.** `purgeMerchantData` يمحو
//     جداول D1 ولا يلمس المتجهات، والمتجه يحمل **النص الخام** بـmetadata.text
//     (سؤال التاجر وجوابه، أو ملاحظة كتبها بنفسه). صفحة الخصوصية تعد بالمحو،
//     وVectorize **لا يدعم الحذف بالفلتر** — فبلا سجل معرّفات لا طريقة أصلاً
//     لمعرفة ما يُحذف. لذلك كل `upsert` هنا يكتب صفاً بـ`vector_refs` أولاً،
//     وكل `deleteByIds` يمحو الصف معه. السجل هو ما يجعل الوعد قابلاً للتنفيذ.
//
//  ٢. **شكل metadata كان مختلفاً بكل موضع** (`{text,...}` لذاكرة التاجر مقابل
//     `{question,reply,score,...}` لأسئلة أورا)، وبرومبتات الاسترجاع تبني
//     `m.question`/`m.reply` دائماً — فذاكرة التاجر كانت تدخل البرومبت
//     «undefined». الشكل موحَّد الآن: `{storeId, kind, text, refId, ts}`.
//
//  ٣. **العزل كان عادة لا ضمانة.** أي استدعاء ينسى `filter.storeId` يقرأ ذاكرة
//     تاجر آخر. هنا `storeId` **إلزامي** (رمي عند غيابه) ويُحقن بكل query.
//
// قاعدة: لا ملف آخر ينادي `VECTORIZE_INDEX.query/upsert/insert/deleteByIds` —
// حارس ح١٠ بـ`scripts/audit-security.mjs` يفشل `npm test` عند أول ارتداد.
import { embedText } from "./gateway.js";

// دفعة واحدة للحذف بالطرفين: حد وسائط D1 أقل بكثير من حد Vectorize، فالرقم
// الأصغر هو الملزِم.
const DELETE_BATCH = 50;

// عتبة تشابه cosine لمؤشر `halah-tr-faq` (bge-m3، 1024-dim — wrangler.toml).
// الكود السابق كان يقارن `metadata.score >= 6` وهي قيمة **ثابتة** كُتبت وقت
// التضمين (10 لأسئلة أورا، غائبة لبقية الأنواع) — أي أن العتبة لم تكن تقيس
// تشابهاً إطلاقاً. القياس الآن من `match.score` الذي يرجّعه المؤشر.
const MIN_SIMILARITY = 0.5;

function requireStoreId(storeId, op) {
  const id = String(storeId ?? "").trim();
  if (!id) throw new Error(`vectorStore.${op}: storeId مطلوب — لا قراءة ولا كتابة بلا عزل متجر.`);
  return id;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** معرّف حتمي: إعادة الحفظ فوق نفس المرجع تستبدل المتجه بدل أن تضيف نسخة. */
export function vectorIdFor(kind, storeId, refId) {
  return `${kind}:${storeId}:${refId}`;
}

/**
 * سجل المعرّفات بـD1. يُكتب **قبل** المتجه عمداً: صف بلا متجه غير ضار (الحذف
 * بمعرّف غير موجود عملية فارغة)، أما متجه بلا صف فهو نص تاجر لا سبيل لمحوه —
 * وهذا بالضبط ما جعل وعد الحذف كاذباً. الفشل يُرمى ولا يُبتلع (fail closed).
 */
async function rememberRef(env, storeId, vectorId, kind, refId) {
  if (!env?.DB) return;
  await env.DB.prepare(
    "INSERT OR REPLACE INTO vector_refs (merchant_id, vector_id, kind, ref_id, created_at) VALUES (?, ?, ?, ?, datetime('now'))"
  )
    .bind(storeId, vectorId, kind, refId)
    .run();
}

async function forgetRefs(env, storeId, ids) {
  if (!env?.DB) return;
  for (const batch of chunk(ids, DELETE_BATCH)) {
    const placeholders = batch.map(() => "?").join(", ");
    await env.DB.prepare(
      `DELETE FROM vector_refs WHERE merchant_id = ? AND vector_id IN (${placeholders})`
    )
      .bind(storeId, ...batch)
      .run();
  }
}

/**
 * يضيف/يستبدل متجهاً واحداً. `id` اختياري: مرّره لمرجع ثابت (سؤال تاجر، سؤال
 * أورا) فيصير الحفظ فوق نفسه استبدالاً؛ اتركه فارغاً لذاكرة حرة متراكمة.
 * @returns {Promise<string|null>} معرّف المتجه، أو null لو لا ربط/لا نص.
 */
export async function upsertVector(env, { storeId, kind, text, refId = "", id = null }) {
  const sid = requireStoreId(storeId, "upsert");
  if (!kind) throw new Error("vectorStore.upsert: kind مطلوب — شكل الـmetadata موحَّد.");
  if (!env?.VECTORIZE_INDEX) return null;
  const body = String(text ?? "").trim();
  if (!body) return null;

  const vectorId = id || vectorIdFor(kind, sid, crypto.randomUUID());
  const ref = String(refId ?? "");
  await rememberRef(env, sid, vectorId, String(kind), ref);

  const values = await embedText({ env, text: body });
  await env.VECTORIZE_INDEX.upsert([
    { id: vectorId, values, metadata: { storeId: sid, kind: String(kind), text: body, refId: ref, ts: Date.now() } }
  ]);
  return vectorId;
}

/**
 * بحث بالتشابه داخل متجر واحد. الفلتر ليس اختياراً: `storeId` يُحقن هنا بكل
 * استعلام، فلا يوجد مسار نداء يقدر ينساه.
 * @returns {Promise<Array<object>>} metadata كل تطابق تجاوز العتبة + `score`.
 */
export async function queryVectors(env, { storeId, text, topK = 5, minScore = MIN_SIMILARITY }) {
  const sid = requireStoreId(storeId, "query");
  if (!env?.VECTORIZE_INDEX) return [];
  const body = String(text ?? "").trim();
  if (!body) return [];
  const values = await embedText({ env, text: body });
  const result = await env.VECTORIZE_INDEX.query(values, {
    topK,
    returnMetadata: "all",
    filter: { storeId: { $eq: sid } }
  });
  return (result?.matches ?? [])
    .filter((m) => m?.metadata)
    // مؤشر لا يرجّع score (محاكاة اختبار، أو نسخة قديمة من الربط) لا يُصفّى —
    // إسقاط كل شيء عند غياب الرقم يعني ذاكرة صامتة بلا سبب ظاهر.
    .filter((m) => typeof m.score !== "number" || m.score >= minScore)
    .map((m) => ({ ...m.metadata, score: typeof m.score === "number" ? m.score : null }));
}

/**
 * يحذف متجهات بمعرّفاتها ويمحو صفوفها من السجل. الترتيب معكوس لترتيب الكتابة:
 * المتجه أولاً، فلو فشل المحو بقي الصف ليُعاد المحاولة عليه لاحقاً.
 */
export async function deleteVectorIds(env, { storeId, ids }) {
  const sid = requireStoreId(storeId, "deleteByIds");
  const list = [...new Set((ids || []).map((x) => String(x ?? "")).filter(Boolean))];
  if (!list.length) return 0;
  if (env?.VECTORIZE_INDEX) {
    for (const batch of chunk(list, DELETE_BATCH)) {
      await env.VECTORIZE_INDEX.deleteByIds(batch);
    }
  }
  await forgetRefs(env, sid, list);
  return list.length;
}

/** كل معرّفات متجهات تاجر — مصدر خطوة المحو بـ`domain/merchantPurge.js`. */
export async function listVectorRefs(env, storeId) {
  const sid = requireStoreId(storeId, "listRefs");
  if (!env?.DB) return [];
  const { results } = await env.DB.prepare(
    "SELECT vector_id FROM vector_refs WHERE merchant_id = ? ORDER BY created_at LIMIT 5000"
  )
    .bind(sid)
    .all();
  return (results || []).map((r) => r?.vector_id).filter(Boolean);
}

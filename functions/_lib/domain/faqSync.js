// مزامنة ذاكرة RAG لودجت الموقع مع جدول hala_faq (2026-09-10).
//
// المشكلة التي يحلّها: `recallSimilar` يعيد النص المحفوظ بالـmetadata وقت التضمين،
// لا صف الجدول. أي تعديل على hala_faq (من الأدمن أو بـwrangler مباشرة) كان يبقى
// حبيس D1 والودجت يرد بالنص القديم — رُصد حياً: الجدول محدَّث والمساعد يعد بـ"فحص
// ٣٠ ثانية" المؤرشف. الحل: بصمة للصفوف بـKV، وكل تِك healthcheck يعيد التضمين
// عند أي فرق. لا شبكة ولا نداء نموذج إن لم يتغير شيء.
import { listHalaFaq } from "./faq.js";
import { reembedHalaFaq, deleteHalaFaqEmbedding } from "../ai/memory.js";

const FAQ_SYNC_KEY = "hala_faq_embed_state";
// 2026-09-17: WP-A8 — بصمة تزامن فقط (لا علم أمني)؛ انتهاؤها أسوأ حالة يعيد
// تضميناً واحداً غير ضروري بأول healthcheck تالٍ، فـ٣٠ يوماً كافية وآمنة.
const FAQ_SYNC_TTL_SECONDS = 30 * 24 * 3600;

export async function faqFingerprint(rows) {
  const text = rows.map((r) => `${r.id}|${r.question}|${r.answer}`).join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * @returns {Promise<{changed:boolean, reembedded:number, deleted:number, skipped?:string}>}
 */
export async function syncHalaFaqEmbeddings(env, { reembed = reembedHalaFaq, remove = deleteHalaFaqEmbedding } = {}) {
  if (!env?.DB || !env?.VECTORIZE_INDEX) return { changed: false, reembedded: 0, deleted: 0, skipped: "bindings" };
  const rows = await listHalaFaq(env);
  const fingerprint = await faqFingerprint(rows);
  const ids = rows.map((r) => r.id);

  let previous = null;
  if (env.HALA_CACHE) {
    const raw = await env.HALA_CACHE.get(FAQ_SYNC_KEY).catch(() => null);
    if (raw) {
      try {
        previous = JSON.parse(raw);
      } catch {
        previous = null;
      }
    }
  }
  if (previous?.fingerprint === fingerprint) return { changed: false, reembedded: 0, deleted: 0 };

  const reembedded = await reembed(env, rows);
  let deleted = 0;
  for (const oldId of previous?.ids || []) {
    if (!ids.includes(oldId)) {
      await remove(env, oldId).catch(() => {});
      deleted++;
    }
  }
  if (env.HALA_CACHE) {
    await env.HALA_CACHE.put(FAQ_SYNC_KEY, JSON.stringify({ fingerprint, ids, at: new Date().toISOString() }), { expirationTtl: FAQ_SYNC_TTL_SECONDS }).catch(() => {});
  }
  return { changed: true, reembedded, deleted };
}

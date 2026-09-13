// مزوّد مدفوع برصيد Hostinger AI Router (nexos.ai) — آخر خيار بعد الطبقات المجانية (قرار المالك 2026-09-13).
// نقطة متوافقة مع OpenAI. المقارنة بنفس اليوم على ٦ صور حقيقية (ساعة، ثوب، شنطة، ٣ فساتين) وكتابة وصفين:
// - GPT 5.6 Luna: ٦/٦ نجاح، أدق نثر عربي، أسرع كتابة — نحو $0.0005 للصورة وللوصف.
// - GLM 5.3 Flash: بنصف السعر وأدق بتفاصيل الفساتين (دانتيل، ترتر، بلا أكمام)، لكن نثره انكسر («شريط بأكية
//   تنتصر») وأخطأ موضع نافذة التاريخ، ولا يقبل إيقاف التفكير. احتياط ثانٍ.
// - أُسقطت: GPT 5.4 nano («ستة أزرار» لثوب بثلاثة)، Haiku 4.5 (يرفض الصور كروابط، «خطوط أفقية» لعمودية)،
//   Mistral Large 3 وStep 3.5 Flash (تفاصيل مخترعة)، Kimi K2.6 (ردود فارغة و١٦ ضعف كلفة Luna)، GPT-OSS بلا صور.
// لا DeepSeek (تخزين بالصين). Luna لا يقبل حرارة غير 1 إلا مع reasoning_effort: none.
export const NEXOS_API_URL = "https://api.nexos.ai/v1/chat/completions";
export const NEXOS_MODEL = "GPT 5.6 Luna";
const NEXOS_FALLBACK_MODEL = "GLM 5.3 Flash";
// سقف نداءات يومي للمشروع كله يحمي الرصيد من حلقة أو إساءة: ٤٠٠ نداء ≈ $0.5 بأسوأ حال. حد الأوصاف (٢٥ باليوم)
// يبقيه بعيداً عادةً. تجاوزه يسقط للطبقات المجانية كما قبل — لا يوقف الخدمة.
export const NEXOS_DAILY_CALLS = 400;
const REASONING_EXTRA_TOKENS = 1000;

/** يحجز نداءً من سقف اليوم. بلا KV لا صرف: حماية الرصيد تفشل مغلقة. */
export async function reserveNexosCall(env) {
  if (!env?.NEXOS_API_KEY || !env.HALA_CACHE) return false;
  const key = `nexos:calls:${new Date().toISOString().slice(0, 10)}`;
  try {
    const used = parseInt((await env.HALA_CACHE.get(key)) || "0", 10) || 0;
    if (used >= NEXOS_DAILY_CALLS) return false;
    await env.HALA_CACHE.put(key, String(used + 1), { expirationTtl: 60 * 60 * 25 });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {object} o
 * @param {string} o.apiKey
 * @param {Array} o.messages - رسائل بصيغة OpenAI (نص أو أجزاء مع image_url)
 * @param {number} o.maxTokens
 * @param {"none"|"low"} [o.reasoning="none"] - الرؤية «low»: ألوان أدق بالتجربة؛ الكتابة «none» مع الحرارة.
 * @param {number} [o.temperature]
 */
export async function askNexos({ apiKey, messages, maxTokens, reasoning = "none", temperature }) {
  const errors = [];
  // GLM «thinking-only»: reasoning_effort none يُرفض بـ400، فيُطلب low دائماً وبلا حرارة.
  for (const [model, effort] of [[NEXOS_MODEL, reasoning], [NEXOS_FALLBACK_MODEL, "low"]]) {
    try {
      return await askNexosModel({ apiKey, model, messages, maxTokens, effort, temperature });
    } catch (err) {
      errors.push(`${model}: ${String(err?.message || err).slice(0, 160)}`);
    }
  }
  throw new Error(`nexos ${errors.join(" | ")}`);
}

async function askNexosModel({ apiKey, model, messages, maxTokens, effort, temperature }) {
  const thinking = effort !== "none";
  const res = await fetch(NEXOS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      reasoning_effort: effort,
      // التفكير يستهلك من نفس الحد: بلا رموز إضافية عاد نص فارغ بـfinish_reason: length (فستان تل مطرز).
      max_tokens: maxTokens + (thinking ? REASONING_EXTRA_TOKENS : 0),
      ...(!thinking && temperature !== undefined ? { temperature } : {})
    })
  });
  if (!res.ok) throw new Error(`${res.status}: ${String(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = await res.json();
  const text = String(data?.choices?.[0]?.message?.content ?? "").trim();
  if (!text) throw new Error(`empty response (${data?.choices?.[0]?.finish_reason || "?"})`);
  return text;
}

// نماذج الرؤية ومسارها — استُخرجت من `ai/gateway.js` بالمرحلة ٤ (النصف ب) بلا
// تغيير سلوكي، لينزل الملفان تحت سقف ٤٠٠ سطر (ARCHITECTURE §٤).
// `gateway.js` يعيد تصدير الواجهة نفسها، فلا يتغيّر أي مستورد.
import { fetchExternalImage } from "../core/security.js";

// ── Vision AI ────────────────────────────────────────────────────────────────
//
// اختيار النموذج (بحث 2026-09-08 — سبب تقني موثّق، لا تفضيل):
//
// النموذج السابق `@cf/meta/llama-3.2-11b-vision-instruct` **لا يدعم العربية
// رسمياً مع الصور**. بطاقة النموذج من ميتا حرفياً:
//   "Note for image+text applications, English is the only language supported."
// (github.com/meta-llama/llama-models · models/llama3_2/MODEL_CARD_VISION.md)
// الدعم متعدد اللغات فيه للنص فقط، والعربية أصلاً ليست ضمن لغاته الثماني.
// فكل وصف عربي أنتجه كان خارج نطاق تدريبه المعلن — وهذا التفسير الجذري لضعف
// الأوصاف الذي رصده صاحب المشروع، لا نقص بالتوجيه ولا بالكتيب.
//
// البديل `@cf/meta/llama-4-scout-17b-16e-instruct`:
//   - **العربية مدعومة رسمياً** (١٢ لغة: عربي · إنجليزي · فرنسي … )
//   - متعدد الوسائط أصلاً (native multimodal) لا محوّل رؤية ملصق
//   - متاح ضمن الحصة المجانية (ليس من السبعة التي تشترط خطة مدفوعة)
//   - ١٣١ ألف رمز سياق · $0.27/$0.85 لكل مليون رمز
//
// نماذج أقوى مستبعدة بسبب: `glm-5.3-flash` و`kimi-k2.6` و`deepseek-v4-*`
// **تشترط خطة مدفوعة** (بوابة تشغيلية)، و`qwen3.8-27b` مخرجاته أغلى ٣.٧×
// ($3.20 مقابل $0.85 لكل مليون رمز مُخرَج) والحمل هنا مخرجات لا مدخلات.
export const VISION_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
// أول محاولة للرؤية (2026-09-11): ملاحظات سكاوت الحقيقية المحفوظة أخطأت ما يظهر بوضوح —
// «مكشوفة الكتفين» لفستان بحمالات رفيعة، و«الأكمام قصيرة وبدون أكمام ظاهرة» لبلوزة بدانتيل
// على الكم فاته. Qwen 3.8 مستضاف على Cloudflare نفسها فلا يتغير وعد «الصور لا تغادر
// Cloudflare». صيغة إدخال الصورة غير موثّقة بصفحته، فأي فشل يسقط لسكاوت كما كان، والسجل
// يسمّي النموذج الذي أجاب (vision= بسطر COPY_LENGTH_RETRY).
const VISION_DETAIL_MODEL = "@cf/qwen/qwen3.8-27b";
// أول توليد بعد النشر أجاب فيه سكاوت لا Qwen (سبب الفشل لم يكن يُسجَّل). Gemma 4 على Workers AI
// أيضاً محاولة ثانية، وسبب فشل كل نموذج صار يصل السجل عبر copy.js (verr=).
const VISION_ALT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
// السابق يبقى **احتياطياً حياً**: صيغة إدخال الصور تختلف بين العائلتين، ولم
// أتحقق من صيغة سكاوت على الإنتاج بعد. الفشل يسقط للسابق بدل أن يُسقط الميزة.
export const VISION_FALLBACK_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000; // تفادي تجاوز حجم مكدس الوسائط بالصور الكبيرة
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function readVisionText(response) {
  const raw = response?.response ?? response?.result?.response;
  if (typeof raw === "string") return raw.trim();
  // صيغة متوافقة مع OpenAI ترجع choices[].message.content
  const choice = response?.choices?.[0]?.message?.content;
  if (typeof choice === "string") return choice.trim();
  return raw ? JSON.stringify(raw).trim() : "";
}

/**
 * Ask the Vision AI model using Cloudflare Workers AI.
 *
 * @param {object} opts
 * @param {any}    opts.env        - Pages Functions env
 * @param {string} [opts.imageUrl] - Public URL of the image
 * @param {ArrayBuffer} [opts.imageBuffer] - Raw image buffer (useful for private WhatsApp media)
 * @param {string} opts.prompt     - The prompt to ask about the image
 * @param {string} [opts.mimeType] - Image mime type for the data URI (default image/jpeg)
 */
export async function askVisionAI(opts) {
  const { text } = await askVisionDetailed(opts);
  return text;
}

/**
 * نفس المسار، لكن يرجّع **تشخيصاً** لا نصاً فقط.
 *
 * سبب وجودها (رُصد 2026-09-09 بفيديو صاحب المشروع): الوصف طلع بلا أي تحليل
 * صورة رغم أن الرابط سليم (تحقُّق مباشر: 200 image/jpeg 35KB) — والمستدعي
 * كان يبلع الخطأ بـ`.catch(() => null)`، وسجل الأخطاء الحي **فاضٍ تماماً**
 * من أي أثر. فشل صامت لا يمكن تشخيصه = ساعة تخمين لكل بلاغ.
 *
 * الآن كل نداء يعود بـ`{ text, model, errors }`: أي نموذج أنتج النص فعلاً،
 * ورسائل فشل ما قبله. المستدعي يسجّلها — لا يبلعها.
 */
export async function askVisionDetailed({ env, imageUrl, imageBuffer, prompt, mimeType = "image/jpeg" }) {
  if (!env.AI) throw new Error("AI binding is missing.");
  const errors = [];

  let buffer = imageBuffer;
  if (!buffer && imageUrl) {
    // N2 — العنوان يأتي من مدخل خارجي (كتالوج سلة، جسم طلب): بلا فحص كان
    // الـWorker وكيل SSRF يقرأ عناوين داخلية، وبلا حد حجم يُستنزف بملف ضخم.
    // fetchExternalImage يفرض https + مضيف عام + ≤8MB + content-type صورة.
    const fetched = await fetchExternalImage(imageUrl);
    buffer = fetched.buffer;
    if (fetched.contentType) mimeType = fetched.contentType.split(";")[0].trim();
  }

  if (!buffer) throw new Error("No image provided");

  const bytes = new Uint8Array(buffer);
  const question = prompt || "صف هذه الصورة بدقة.";

  // المسار الأساسي: صيغة رسائل متعددة الأجزاء (سكاوت متعدد الوسائط أصلاً).
  const dataUrl = `data:${mimeType};base64,${bytesToBase64(bytes)}`;
  for (const model of [VISION_DETAIL_MODEL, VISION_ALT_MODEL, VISION_MODEL]) {
  try {
    const response = await env.AI.run(model, {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: question },
            {
              type: "image_url",
              image_url: { url: dataUrl }
            }
          ]
        }
      ],
      max_tokens: 700,
      // Qwen 3.8 وGemma 4 نماذج «تفكير»: بلا هذا تُستهلك الرموز بالتفكير ويعود نص فارغ فيسقط
      // الطلب لسكاوت (مثال Gemma 4 بتوثيق Cloudflare يمرّره). لا يُرسل لسكاوت كي لا يُرفض.
      ...(model !== VISION_MODEL ? { chat_template_kwargs: { enable_thinking: false } } : {})
    });
    const text = readVisionText(response);
    if (text) return { text, model, errors };
    throw new Error("vision model returned empty text");
  } catch (err) {
    // لا نُسقط الميزة على تغيّر صيغة أو نموذج غير متاح — نسقط للسابق ونسجّل.
    errors.push(`${model}: ${String(err?.message || err).slice(0, 160)}`);
  }
  }

  try {
    const response = await env.AI.run(VISION_FALLBACK_MODEL, {
      prompt: question,
      image: [...bytes]
    });
    const text = readVisionText(response);
    if (text) return { text, model: VISION_FALLBACK_MODEL, errors };
    errors.push(`${VISION_FALLBACK_MODEL}: empty text`);
  } catch (err) {
    errors.push(`${VISION_FALLBACK_MODEL}: ${String(err?.message || err).slice(0, 160)}`);
  }

  return { text: "", model: null, errors };
}

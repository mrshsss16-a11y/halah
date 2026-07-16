// POST /api/copy
// body: { name, price, tone, category, features }
// (path + { result } response shape match studio.html's generateCopy() fetch call — unchanged)
//
// Real Workers AI product copy grounded in the Hala marketer persona,
// replacing the local SAMPLE_COPIES template pool.
import { withApi } from "../_lib/respond.js";
import { askWorkersAI } from "../_lib/workersAI.js";
import { PERSONA_SYSTEM_PROMPT } from "../_lib/persona.js";

const TONE_LABELS = {
  white: "لهجة بيضاء تسويقية ودودة",
  formal: "فصحى رسمية راقية",
  luxury: "فخامة وحصرية",
  deals: "حماس عروض بدون إلحاح كاذب",
  funny: "خفة دم سعودية لطيفة"
};

function buildSystem() {
  return `${PERSONA_SYSTEM_PROMPT}

---

## مهمتك الآن: كتابة وصف منتج

اكتبي وصف منتج بالنبرة المطلوبة فقط، 2-3 جمل، طبيعي وجاهز للنشر مباشرة بصفحة المنتج أو رسالة
واتساب. أرجعي النص فقط بدون أي مقدمة أو علامات تنصيص أو JSON — فقط الوصف النهائي.`;
}

async function copyHandler(body, env) {
  const name = (body.name || "").toString().trim().slice(0, 200);
  const price = (body.price || "").toString().trim().slice(0, 40);
  const tone = TONE_LABELS[body.tone] ? body.tone : "white";
  const category = (body.category || "").toString().trim().slice(0, 60);
  const features = (body.features || "").toString().trim().slice(0, 500);

  if (!name) {
    return { error: "أدخل اسم المنتج أولاً." };
  }

  const result = await askWorkersAI({
    env,
    system: buildSystem(),
    messages: [
      {
        role: "user",
        content: `اسم المنتج: ${name}\nالسعر: ${price || "غير محدد"} ريال\nالفئة: ${category || "غير محددة"}\nمزايا إضافية: ${features || "لا يوجد"}\nالنبرة المطلوبة: ${TONE_LABELS[tone]} (قيمة: ${tone})`
      }
    ],
    maxTokens: 300
  });

  if (!result) {
    throw new Error("empty copy result from model");
  }

  return { result, tone, name, price };
}

export const onRequestPost = withApi(copyHandler);

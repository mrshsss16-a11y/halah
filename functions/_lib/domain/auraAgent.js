// مجال وكيل أورا الرسمي على واتساب — أدوات شاشة الأدمن فقط
// (المرحلة ٤: نُقل من `api/admin/aura_whatsapp.js` بلا تغيير سلوكي).
//
// خط أورا نفسه، لا متجر تاجر: `storeId: "hala"` ثابت و`m_admin_aura` معرّف
// الاتصال. الشخصية من مصدرها الوحيد `ai/persona.js` (AGENT.md §٨) — لا نسخة.
import { askWorkersAI, TEXT_MODEL } from "../ai/gateway.js";
import { HALA_WHATSAPP_SUPPORT_PROMPT } from "../ai/persona.js";
import { listHalaFaq } from "./faq.js";
import { savePlatformConnection } from "./platforms.js";
import { matchFastIntent } from "../ai/intents.js";

const AURA_MERCHANT_ID = "m_admin_aura";

/** حالة الربط + عدد عناصر المعرفة + نص الشخصية المستخدَم فعلاً. */
export async function auraConfig(env) {
  const hasToken = Boolean(env.WHATSAPP_TOKEN);
  const faqs = await listHalaFaq(env).catch(() => []);
  return {
    whatsapp: {
      hasToken,
      phoneId: env.WHATSAPP_PHONE_ID || "لم يتم التخصيص بعد",
      hasVerifyToken: Boolean(env.WHATSAPP_VERIFY_TOKEN),
      agentName: "موظفة أورا للتسويق الرقمية (Aura Assistant)",
      status: hasToken ? "متصل بالواتساب الرسمي" : "وضع النمذجة والتجربة التفاعلية"
    },
    agent: {
      storeId: AURA_MERCHANT_ID,
      name: "موظفة أورا للتسويق",
      dialect: "saudi_white",
      ragItemsCount: faqs.length,
      prompt: HALA_WHATSAPP_SUPPORT_PROMPT
    }
  };
}

/** يحفظ مفاتيح خط أورا. P25: لا سر افتراضي مكتوب — الغائب يُخزَّن null. */
export async function saveAuraCredentials(env, { token, phoneId }) {
  if (!token || !phoneId || !env?.DB) return;
  await savePlatformConnection(env, {
    merchantId: AURA_MERCHANT_ID,
    platform: "whatsapp",
    sellerId: phoneId,
    apiKey: token,
    apiSecret: env.WHATSAPP_VERIFY_TOKEN || null,
    environment: "prod",
    storeName: "أورا للتسويق - واتساب الرسمي"
  }).catch(() => {});
}

/** تجربة رد الوكيل بشخصيته الحقيقية. فشل المزوّد يردّ نصاً ثابتاً لا خطأ. */
export async function testAuraReply(env, message) {
  const startTime = performance.now();
  let agentReply;
  try {
    agentReply = await askWorkersAI({
      env,
      system: HALA_WHATSAPP_SUPPORT_PROMPT,
      messages: [{ role: "user", content: message }],
      maxTokens: 250,
      model: TEXT_MODEL,
      storeId: "hala" // خط أورا نفسه، لا متجر تاجر
    });
  } catch {
    agentReply = "أهلاً بك في أورا للتسويق! 👋 نقدم خدمات التسويق الذكي واسترداد السلات المتروكة عبر الواتساب. نتشرف بحجز استشارة مخصصة لمتجرك في أي وقت!";
  }
  return {
    agentReply,
    latencyMs: `${Math.round(performance.now() - startTime)}ms`,
    source: "Aura Official Agent (Workers AI)",
    testedAt: new Date().toISOString()
  };
}

/**
 * اختبار ميزة مفردة. N10: `cart_recovery_sim` كان يرجّع عميلاً وهمياً ومبلغاً
 * مخترعاً و"تم الإرسال بنجاح" لرسالة لم تُرسل (§١١) — الرد الصادق هو الاعتراف
 * بأن الميزة غير مبنية.
 */
export function testAuraFeature(feature, input) {
  if (feature === "intent_matching") {
    const t0 = performance.now();
    const matched = matchFastIntent(input, "saudi_white");
    return {
      ok: true,
      feature: "Fast Intent Matching Engine (< 1ms)",
      input,
      matchedIntent: matched ? matched.intent : "AI Cascade Fallback",
      latency: `${(performance.now() - t0).toFixed(2)}ms`
    };
  }
  if (feature === "cart_recovery_sim") {
    return { ok: false, code: "NOT_AVAILABLE", error: "استرداد السلات المتروكة غير مبني حالياً — لا توجد بيانات حقيقية لعرضها." };
  }
  return { ok: false, error: "الميزة المراد اختبارها غير معروفة." };
}

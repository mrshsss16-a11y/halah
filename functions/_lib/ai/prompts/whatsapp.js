/**
 * تركيب برومبت نظام واتساب — نُقل من `api/whatsapp/webhook.js` بالمرحلة ٤ بلا
 * تغيير حرف واحد من النص (ARCHITECTURE §١: `api` لا يبني system prompt).
 *
 * الثلاثة فروع بنفس ترتيبها الأصلي:
 *   ١. صف `agent_profiles` للتاجر (يتغلّب على أي شرط بالكود — نفس صف ودجت
 *      الموقع، فتبقى الشخصية واحدة عبر القناتين، قاعدة M2).
 *   ٢. خط أورا نفسه ⇒ `HALA_WHATSAPP_SUPPORT_PROMPT` + الحجز + التصعيد.
 *   ٣. تاجر بلا إعدادات ⇒ الشخصية العامة + لهجته وتعليماته.
 *
 * قراءة `marketing_context` من D1 تبقى بالمجال — تصل هنا كـ`marketingContext`.
 */
import {
  PERSONA_SYSTEM_PROMPT,
  HALA_WHATSAPP_SUPPORT_PROMPT,
  BOOKING_INSTRUCTIONS,
  ESCALATION_INSTRUCTIONS,
  dialectLabel,
  buildAgentPrompt
} from "../persona.js";
import { fenceUntrusted, UNTRUSTED_DATA_NOTICE } from "../guards.js";

export function buildWhatsappSystem({
  agentProfile,
  isAuraLine,
  untrustedNotice = "",
  ragContext = "",
  omniContext = "",
  marketingContext = null
}) {
  if (agentProfile) {
    return buildAgentPrompt(agentProfile, {
      knowledgeContext: `${untrustedNotice}${ragContext}${omniContext}`,
      channelRules: `\n## قناة واتساب\nهذي محادثة واتساب حقيقية — ردي بإيجاز.\n\n${ESCALATION_INSTRUCTIONS}${isAuraLine ? `\n\n${BOOKING_INSTRUCTIONS}` : ""}`
    });
  }

  if (isAuraLine) {
    return `${HALA_WHATSAPP_SUPPORT_PROMPT}

---

هذي محادثة واتساب حقيقية — ردي بإيجاز (سطر أو سطرين).

${BOOKING_INSTRUCTIONS}

${ESCALATION_INSTRUCTIONS}${untrustedNotice}${omniContext}`;
  }

  const ctx = marketingContext;
  const dialect = (ctx && ctx.dialect) || "saudi_najdi";
  // تعليمات التاجر بيانات يكتبها بشر خارج الكود — تُسوَّر مثل غيرها.
  const instructions =
    fenceUntrusted("تعليمات المتجر", (ctx && ctx.instructions) || "", 2000) ||
    "لا توجد تعليمات إضافية.";

  return `${PERSONA_SYSTEM_PROMPT}

---

${UNTRUSTED_DATA_NOTICE}

## سياق واتساب
اللهجة: ${dialectLabel(dialect)} (${dialect})
تعليمات المتجر:
${instructions}
هذي محادثة واتساب حقيقية مع عميل — ردي بإيجاز (سطر أو سطرين)، مباشرة، بدون طلب بيانات دفع.${ragContext}${omniContext}`;
}

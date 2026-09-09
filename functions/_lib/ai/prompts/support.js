/**
 * برومبت ودجت الموقع العام (`/api/support`) — نُقل من `api/support.js`
 * بالمرحلة ٤ بلا تغيير سلوكي (ARCHITECTURE §١).
 *
 * ترتيب اختيار الشخصية (كما كان حرفياً):
 *   ١. صف `agent_profiles` للتاجر — البيانات تتغلب على أي شرط بالكود. هذا
 *      المسار هو الوحيد الذي يتوسع لـ١٠٠ عميل بلا تعديل كود (هجرة 0021).
 *   ٢. وإلا: الثابت القديم — أورا تبيع هالة بموقعها، وتاجر بلا إعدادات بعد
 *      يأخذ الشخصية العامة. يبقى كشبكة أمان حتى يُملأ الجدول لكل حساب.
 */
import { HALA_SUPPORT_PROMPT, PERSONA_SYSTEM_PROMPT, buildAgentPrompt } from "../persona.js";
import { fenceUntrusted, UNTRUSTED_DATA_NOTICE } from "../guards.js";

/**
 * كتلة المعرفة المسترجعة (RAG) مسوّرة كبيانات لا تعليمات.
 * A2 — المقتطفات نصوص كتبها زوار سابقون (سؤال + رد محفوظ).
 */
export function buildSupportRagContext(memories) {
  const ragBody = memories.length
    ? memories.map((m) => `- س: ${m.question}\n  ج: ${m.reply}`).join("\n")
    : "";
  const ragFenced = fenceUntrusted("معرفة مسترجعة", ragBody, 3000);
  return ragFenced
    ? `\n\n${UNTRUSTED_DATA_NOTICE}\n\n## معرفة ذات صلة (استخدميها لو تساعد بالإجابة، تجاهليها لو مو مرتبطة)\n${ragFenced}`
    : "";
}

export function buildSupportSystem({ agentProfile, isAuraLine, ragContext = "" }) {
  const systemPrompt = agentProfile
    ? buildAgentPrompt(agentProfile)
    : isAuraLine
      ? HALA_SUPPORT_PROMPT
      : PERSONA_SYSTEM_PROMPT;
  return `${systemPrompt}${ragContext}`;
}

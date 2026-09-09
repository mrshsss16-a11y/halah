/**
 * برومبت مسودات إنستغرام — نُقل من `api/instagram/webhook.js` بالمرحلة ٤ بلا
 * تغيير سلوكي (ARCHITECTURE §١).
 *
 * التعليق العلني والرسالة المباشرة قناتان بقواعد مختلفة (نافذة، علنية، حدود
 * Meta)، فلكل واحدة كتلة قواعدها من `persona.js` — والشخصية نفسها مصدر واحد.
 */
import {
  HALA_WHATSAPP_SUPPORT_PROMPT,
  INSTAGRAM_PUBLIC_COMMENT_RULES,
  INSTAGRAM_DM_RULES
} from "../persona.js";

export function buildInstagramSystem(kind) {
  const channelRules = kind === "comment" ? INSTAGRAM_PUBLIC_COMMENT_RULES : INSTAGRAM_DM_RULES;
  return `${HALA_WHATSAPP_SUPPORT_PROMPT}\n\n${channelRules}`;
}

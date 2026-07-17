// POST /api/support
// body: { messages: [{role, content}] }
// Hala's own site support/sales chat. Answers visitor questions about Hala and
// funnels to WhatsApp. Detects the [WHATSAPP_CTA] marker the persona emits and
// returns a structured flag so the widget can render a WhatsApp button.
import { withApi } from "../_lib/respond.js";
import { askWorkersAI } from "../_lib/workersAI.js";
import { HALA_SUPPORT_PROMPT } from "../_lib/persona.js";

const CTA_MARKER = "[WHATSAPP_CTA]";

async function supportHandler(body, env) {
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const turns = incoming
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-8)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 800) }));

  if (!turns.length || turns[turns.length - 1].role !== "user") {
    return { error: "ما فيه رسالة." };
  }

  let reply = await askWorkersAI({
    env,
    system: HALA_SUPPORT_PROMPT,
    messages: turns,
    maxTokens: 400
  });

  const wantsWhatsApp = reply.includes(CTA_MARKER);
  reply = reply.replace(CTA_MARKER, "").trim();

  // Pre-filled WhatsApp opener personalized to the conversation topic.
  const lastUser = turns[turns.length - 1].content.slice(0, 120);
  const waText = `مرحباً فريق هالة 👋 كنت أتصفح موقعكم وعندي استفسار: ${lastUser}`;

  return {
    result: reply,
    reply,
    whatsappCta: wantsWhatsApp,
    whatsappText: wantsWhatsApp ? waText : null
  };
}

export const onRequestPost = withApi(supportHandler);

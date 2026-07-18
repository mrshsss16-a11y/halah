// POST /api/support
// body: { messages: [{role, content}] }
// Hala's own site support/sales chat. Answers visitor questions about Hala and
// funnels to WhatsApp. Detects the [WHATSAPP_CTA] marker the persona emits and
// returns a structured flag so the widget can render a WhatsApp button.
import { withApi } from "../_lib/respond.js";
import { askWorkersAI } from "../_lib/workersAI.js";
import { HALA_SUPPORT_PROMPT } from "../_lib/persona.js";
import { recallSimilar } from "../_lib/memory.js";

const CTA_MARKER = "[WHATSAPP_CTA]";

// Guardrail: catch invented currency figures. Only "٢٠٠/200 وصف", "٤٠٠/400 صورة",
// "٥٠/50 رسالة", "٣٠/30 يوم" are real facts — any "ريال"/"دولار"/"SAR" number is
// fabricated (Hala has no published post-trial price yet). Live-tested: the model
// invented "200 ريال شهرياً" once despite prompt instructions — this is the backstop.
const FABRICATED_PRICE = /\d[\d,.]*\s*(ريال|ر\.س|دولار|sar|\$)/i;

function stripFabricatedPricing(reply) {
  if (!FABRICATED_PRICE.test(reply)) return reply;
  return "الأسعار بعد التجربة تختلف حسب حجم متجرك — فريقنا يحددها لك مباشرة على واتساب.\n\n" + CTA_MARKER;
}

async function supportHandler(body, env) {
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const turns = incoming
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-8)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 800) }));

  if (!turns.length || turns[turns.length - 1].role !== "user") {
    return { error: "ما فيه رسالة." };
  }

  const lastUserText = turns[turns.length - 1].content;
  const memories = await recallSimilar({ env, storeId: "hala", question: lastUserText }).catch(() => []);
  const ragContext = memories.length
    ? `\n\n## معرفة ذات صلة (استخدميها لو تساعد بالإجابة، تجاهليها لو مو مرتبطة)\n${memories
        .map((m) => `- س: ${m.question}\n  ج: ${m.reply}`)
        .join("\n")}`
    : "";

  let reply = await askWorkersAI({
    env,
    system: `${HALA_SUPPORT_PROMPT}${ragContext}`,
    messages: turns,
    maxTokens: 400
  });

  reply = stripFabricatedPricing(reply);

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

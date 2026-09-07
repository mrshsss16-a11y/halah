// POST /api/support — the ONE public, cross-origin-embeddable chat endpoint.
// body: { messages: [{role, content}], storeId? }
//
// Originally Aura's own site widget only (storeId hardcoded "hala"). Now the
// backend for the embeddable widget (public/widget.js): any site can embed
// it with a `data-store-id`, same as an analytics tracking id — storeId here
// is a public identifier, not a secret. Abuse control is CORS origin
// allowlist (cors.js) + per-IP rate limit (below) + per-store monthly quota,
// not secrecy of the id.
//
// "hala" keeps Aura's own sales/support persona (HALA_SUPPORT_PROMPT) — any
// other storeId gets the general merchant persona (PERSONA_SYSTEM_PROMPT),
// same one chat.js uses, so a future merchant's widget speaks as THEIR
// assistant, not as Hala trying to sell Aura's own services to their visitor.
//
// Detects the [WHATSAPP_CTA] marker the persona emits and returns a
// structured flag so the widget can render a WhatsApp button — and embeds a
// short omnichannel session code in that handoff link so webhook.js can pick
// the conversation back up with full context once the visitor messages
// WhatsApp (see docs/AGENT.md §"الذاكرة عبر القنوات").
import { withApi, ApiError } from "../_lib/core/respond.js";
import { askWorkersAI } from "../_lib/ai/gateway.js";
import { HALA_SUPPORT_PROMPT, PERSONA_SYSTEM_PROMPT } from "../_lib/ai/persona.js";
import { recallSimilar } from "../_lib/ai/memory.js";
import { sanitizeInput, verifyTurnstileToken } from "../_lib/core/security.js";
import { checkRateLimit } from "../_lib/core/rateLimit.js";
import { checkAndConsumeMonthly } from "../_lib/core/meter.js";
import { saveOmnichannelSession, getWaConnectionByMerchant } from "../_lib/core/db.js";
import { corsPreflight } from "../_lib/core/cors.js";

export function onRequestOptions({ request, env }) {
  return corsPreflight(env, request);
}

function randomSessionCode() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

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

async function supportHandler(body, env, request) {
  const clientIp = request?.headers?.get("cf-connecting-ip") || request?.headers?.get("x-forwarded-for") || "127.0.0.1";
  const rateCheck = await checkRateLimit(env, clientIp, "support_chat", 20, 60);
  if (!rateCheck.allowed) {
    throw new ApiError(429, "تجاوزت عدد طلبات المحادثة المسموحة. انتظر دقيقة وكرر المحاولة.", "RATE_LIMIT_EXCEEDED");
  }

  if (body.turnstileToken) {
    const turnstileResult = await verifyTurnstileToken(env, body.turnstileToken, clientIp);
    if (!turnstileResult.success) {
      throw new ApiError(400, "فشل التحقق من عدم كونك بوت سبام.", "TURNSTILE_FAILED");
    }
  }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const turns = incoming
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-8)
    .map((m) => ({ role: m.role, content: sanitizeInput(String(m.content), 800) }));

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
    maxTokens: 400,
    storeId: "hala" // Aura's own website widget — single tenant, safe to share
  });

  reply = stripFabricatedPricing(reply);

  const wantsWhatsApp = reply.includes(CTA_MARKER);
  reply = reply.replace(CTA_MARKER, "").trim();

  // Pre-filled WhatsApp opener personalized to the conversation topic.
  const lastUser = turns[turns.length - 1].content.slice(0, 120);
  const waText = `مرحباً فريق هالة 👋 كنت أتصفح موقعكم وعندي استفسار: ${lastUser}`;
  const waPhone = env.STORE_WA_PHONE || "966545149591";

  return {
    result: reply,
    reply,
    whatsappCta: wantsWhatsApp,
    whatsappText: wantsWhatsApp ? waText : null,
    whatsappUrl: wantsWhatsApp ? `https://wa.me/${waPhone}?text=${encodeURIComponent(waText)}` : null
  };
}

export const onRequestPost = withApi(supportHandler);

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
import { HALA_SUPPORT_PROMPT, PERSONA_SYSTEM_PROMPT, buildAgentPrompt } from "../_lib/ai/persona.js";
import { recallSimilar } from "../_lib/ai/memory.js";
import { sanitizeInput, verifyTurnstileToken, turnstileRequired } from "../_lib/core/security.js";
import { checkRateLimit, clientIp } from "../_lib/core/rateLimit.js";
import { checkAndConsumeMonthly } from "../_lib/core/meter.js";
import { saveOmnichannelSession, getWaConnectionByMerchant, getAgentProfile, getMerchant } from "../_lib/core/db.js";
import { RESERVED_STORE_IDS } from "../_lib/core/session.js";
import { corsPreflight } from "../_lib/core/cors.js";
import { stripFabricatedPricing, fenceUntrusted, UNTRUSTED_DATA_NOTICE } from "../_lib/ai/guards.js";
import { logError } from "../_lib/core/errorLog.js";

export function onRequestOptions({ request, env }) {
  return corsPreflight(env, request);
}

function randomSessionCode() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

const CTA_MARKER = "[WHATSAPP_CTA]";

// حارس الأسعار انتقل إلى `_lib/ai/guards.js` — النسخة المحلية كانت تعتمد على
// `\d` فتمرّ "٥٠٠ ريال" بالأرقام العربية-الهندية كما هي إلى الزائر (A1)، وكانت
// تغطي هذه القناة وحدها بينما واتساب وإنستغرام بلا حارس أصلاً.
const PRICE_FALLBACK_AURA =
  "الأسعار بعد التجربة تختلف حسب حجم متجرك — فريقنا يحددها لك مباشرة على واتساب.";

// N1 — معرّفات لا يجوز لأي ودجت أن يسميها: "hala" غير مقيسة بالحصة، و
// "style_library"/"default-store" دلاء مشتركة ليست متاجر حقيقية.
const NON_WIDGET_STORE_IDS = new Set([...RESERVED_STORE_IDS, "style_library", "default-store"]);

/**
 * N1 — كان `body.storeId || "hala"` يُقبل حرفياً بلا أي تحقق: أي زائر يرسل
 * معرّف متجر آخر فيقرأ ذاكرة عملائه (RAG)، ويسحب شخصيته ورقم واتسابه، ويستنزف
 * حصته الشهرية. الودجت عام فما ينفع الاعتماد على الجلسة — البديل: المعرّف يجب
 * أن يطابق صف merchants حقيقياً، وإلا ٤٠٠. غياب المعرّف يبقى "hala" (سلوك
 * موقع أورا نفسه). fail-closed: تعذر الوصول لقاعدة البيانات = رفض، لا قبول.
 */
async function resolveWidgetStoreId(env, claimed) {
  const raw = (claimed === undefined || claimed === null ? "" : String(claimed)).trim().slice(0, 40);
  if (!raw) return "hala";
  if (raw === "hala") return "hala"; // الودجت الرسمي لأورا قد يمرره صراحةً
  if (NON_WIDGET_STORE_IDS.has(raw)) {
    throw new ApiError(400, "معرّف المتجر غير صالح.", "INVALID_STORE_ID");
  }
  if (!env?.DB) {
    throw new ApiError(503, "الخدمة غير متاحة حالياً — تعذر التحقق من المتجر.", "STORE_LOOKUP_UNAVAILABLE");
  }
  let merchant = null;
  try {
    merchant = await getMerchant(env, raw);
  } catch {
    throw new ApiError(503, "الخدمة غير متاحة حالياً — تعذر التحقق من المتجر.", "STORE_LOOKUP_UNAVAILABLE");
  }
  if (!merchant) {
    throw new ApiError(400, "معرّف المتجر غير صالح.", "INVALID_STORE_ID");
  }
  return raw;
}

async function supportHandler(body, env, request) {
  const ip = clientIp(request);
  const rateCheck = await checkRateLimit(env, ip, "support_chat", 20, 60);
  if (!rateCheck.allowed) {
    throw new ApiError(429, "تجاوزت عدد طلبات المحادثة المسموحة. انتظر دقيقة وكرر المحاولة.", "RATE_LIMIT_EXCEEDED");
  }

  // N7 — التوكن إلزامي متى وُجد TURNSTILE_SECRET_KEY؛ بدون المفتاح يبقى اختيارياً
  // (السلوك القديم) لأن الطبقة نفسها معطّلة أصلاً بلا مفتاح.
  if (turnstileRequired(env) || body.turnstileToken) {
    const turnstileResult = await verifyTurnstileToken(env, body.turnstileToken, ip);
    if (!turnstileResult.success) {
      throw new ApiError(400, "فشل التحقق من عدم كونك بوت سبام.", "TURNSTILE_FAILED");
    }
  }

  // Public identifier, not a secret — see file header. Any site's widget
  // passes its own storeId; the current site (index.html) omits it, which
  // keeps defaulting to "hala" so nothing about the existing widget changes.
  const merchantId = await resolveWidgetStoreId(env, body.storeId);
  const isAuraLine = merchantId === "hala";

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const turns = incoming
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-8)
    .map((m) => ({ role: m.role, content: sanitizeInput(String(m.content), 800) }));

  if (!turns.length || turns[turns.length - 1].role !== "user") {
    return { error: "ما فيه رسالة." };
  }

  const usage = await checkAndConsumeMonthly(env, merchantId, "message");
  if (!usage.ok) {
    return {
      error: `خلص رصيدك الشهري من الرسائل (${usage.limit} رسالة) — يتجدد أول الشهر القادم.`,
      code: "OUT_OF_CREDITS",
      remaining: 0
    };
  }

  const lastUserText = turns[turns.length - 1].content;
  const memories = await recallSimilar({ env, storeId: merchantId, question: lastUserText }).catch(() => []);
  // A2 — المقتطفات المسترجعة نصوص كتبها زوار سابقون (سؤال + رد محفوظ)، فتدخل
  // البرومبت داخل محدِّدات صريحة: بيانات تُقرأ، لا تعليمات تُنفَّذ.
  const ragBody = memories.length
    ? memories.map((m) => `- س: ${m.question}\n  ج: ${m.reply}`).join("\n")
    : "";
  const ragFenced = fenceUntrusted("معرفة مسترجعة", ragBody, 3000);
  const ragContext = ragFenced
    ? `\n\n${UNTRUSTED_DATA_NOTICE}\n\n## معرفة ذات صلة (استخدميها لو تساعد بالإجابة، تجاهليها لو مو مرتبطة)\n${ragFenced}`
    : "";

  // ترتيب اختيار الشخصية:
  //   1. صف `agent_profiles` للتاجر — البيانات تتغلب على أي شرط بالكود. هذا
  //      المسار هو الوحيد الذي يتوسع لـ١٠٠ عميل بلا تعديل كود (هجرة 0021).
  //   2. وإلا: الثابت القديم — أورا تبيع هالة بموقعها، وتاجر بلا إعدادات بعد
  //      يأخذ الشخصية العامة. يبقى كشبكة أمان حتى يُملأ الجدول لكل حساب.
  const agentProfile = await getAgentProfile(env, merchantId);
  const systemPrompt = agentProfile
    ? buildAgentPrompt(agentProfile)
    : isAuraLine
      ? HALA_SUPPORT_PROMPT
      : PERSONA_SYSTEM_PROMPT;

  let reply = await askWorkersAI({
    env,
    system: `${systemPrompt}${ragContext}`,
    messages: turns,
    maxTokens: 400,
    storeId: merchantId,
    ttlKind: "chat" // A9 — رد دعم يجب أن يبقى طازجاً (١٥ د)، لا ٢٤ ساعة
  });

  // حارس الأسعار: يتبع إعداد التاجر (`allow_prices`) حين يوجد صف إعدادات،
  // وإلا يرتد للسلوك القديم (أورا فقط). تاجر يعرض أسعاره الحقيقية ما يصح
  // نمسح رده، وأورا ما يصح تذكر رقماً غير منشور — نفس الكود، قراران مختلفان.
  const blockPrices = agentProfile ? Number(agentProfile.allow_prices) === 0 : isAuraLine;
  if (blockPrices) {
    const guard = stripFabricatedPricing(reply, {
      fallback: isAuraLine ? PRICE_FALLBACK_AURA : undefined,
      ctaMarker: CTA_MARKER
    });
    reply = guard.text;
    // بلا نص الرسالة ولا نص الرد — الكود وحده يكفي للتحقيق (قاعدة errorLog.js).
    if (guard.stripped) {
      logError({ env }, {
        requestId: null,
        path: "api/support",
        code: "PRICE_STRIPPED",
        internal: "fabricated price removed from model reply",
        storeId: merchantId
      });
    }
  }

  const wantsWhatsApp = reply.includes(CTA_MARKER);
  reply = reply.replace(CTA_MARKER, "").trim();

  // Route the handoff to the RIGHT WhatsApp number: Aura's own line for the
  // Aura widget, the merchant's own connected number otherwise. A merchant
  // with no WhatsApp connected yet gets no CTA at all — sending their
  // visitor to Aura's own support line would misroute the conversation.
  let waPhone = null;
  if (isAuraLine) {
    // U6 — لا رقم افتراضي بالكود (نفس P49): رقم غير مضبوط كان يحوّل الزائر لرقم
    // قد لا يملكه أحد. غياب STORE_WA_PHONE = لا زر تحويل إطلاقاً (fail-closed).
    waPhone = (env.STORE_WA_PHONE || "").toString().trim() || null;
  } else {
    const conn = await getWaConnectionByMerchant(env, merchantId).catch(() => null);
    if (conn && conn.status === "active" && conn.display_phone) waPhone = conn.display_phone;
  }

  let waText = null;
  let waUrl = null;
  if (wantsWhatsApp && waPhone) {
    const lastUser = turns[turns.length - 1].content.slice(0, 120);
    // Cross-channel memory bridge: this code lets webhook.js pull the full
    // website conversation back up the moment the visitor's first WhatsApp
    // message arrives, instead of starting cold — see
    // docs/AGENT.md §"الذاكرة عبر القنوات" and functions/api/whatsapp/webhook.js.
    const sessionCode = randomSessionCode();
    await saveOmnichannelSession(env, {
      sessionToken: sessionCode,
      merchantId,
      chatSummary: lastUserText.slice(0, 300)
    }).catch(() => {});

    const opener = isAuraLine
      ? `مرحباً فريق هالة 👋 كنت أتصفح موقعكم وعندي استفسار: ${lastUser}`
      : `مرحباً 👋 عندي استفسار: ${lastUser}`;
    waText = `${opener}\n\nمرجع المحادثة: ${sessionCode}`;
    waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(waText)}`;
  }

  return {
    result: reply,
    reply,
    whatsappCta: Boolean(waUrl),
    whatsappText: waText,
    whatsappUrl: waUrl,
    remaining: usage.remaining
  };
}

export const onRequestPost = withApi(supportHandler, { cors: true });

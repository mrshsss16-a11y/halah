// مجال الرد التلقائي على واتساب — نُقل من `api/whatsapp/webhook.js` بالمرحلة ٤
// (ARCHITECTURE §٢) بلا تغيير سلوكي: نفس ترتيب الأحداث، نفس بوابات التصعيد،
// نفس نافذة الصمت، نفس رسائل العميل حرفياً.
//
// الويبهوك نفسه بقي بـ`api/`: تحقق التوقيع ← حد معدل ← parse ←
// `handleInboundBatch` (بـ`whatsappInbound.js`) داخل waitUntil ← 200.
//
// Inbound flow: verify X-Hub-Signature-256 → record → auto-reply with the
// marketer persona (this is the "customer-service AI connected to WhatsApp").
// Replies only within the 24h service window (free-form allowed there).
import { askWorkersAI, TEXT_MODEL } from "../ai/gateway.js";
import { buildWhatsappSystem } from "../ai/prompts/whatsapp.js";
import { recallSimilar, formatMemory } from "../ai/memory.js";
import { checkAndConsumeMonthly } from "../core/meter.js";
import { matchAuraGreeting, matchFastIntent } from "../ai/intents.js";
import { logError } from "../core/errorLog.js";
import { checkRateLimit } from "../core/rateLimit.js";
import { stripFabricatedPricing, fenceUntrusted, UNTRUSTED_DATA_NOTICE } from "../ai/guards.js";
import {
  recentWaHistory,
  getLastHumanReplyAt,
  countRecentInboundWithoutResolution
} from "./whatsapp.js";
import { getOmnichannelSession, saveOmnichannelSession } from "./conversation.js";
import { getMarketingContext, getAgentProfile } from "./persona.js";
import { saveConsultationBooking } from "./booking.js";

// Manager decision 2026-09-06: quota-check errors (D1/KV outage) stay
// fail-OPEN — a transient infra blip must not stop the bot replying to every
// merchant at once. The tradeoff (a few unmetered messages during a rare
// outage) is deliberate. What was missing before: visibility. Every failure
// is now logged, and if it repeats ≥5 times in 10 minutes (a real outage, not
// a blip) a KV flag is set for healthcheck.js to pick up and alert on — see
// docs/AGENT.md §13 and docs/TRACK_B_HALA_EXECUTION.md.
const QUOTA_FAIL_ALERT_KEY = "wa_quota_check_degraded";
const QUOTA_FAIL_ALERT_TTL_SECONDS = 600; // matches the 10-minute window below

async function flagQuotaCheckDegraded(env) {
  if (!env.HALA_CACHE) return;
  await env.HALA_CACHE.put(QUOTA_FAIL_ALERT_KEY, new Date().toISOString(), {
    expirationTtl: QUOTA_FAIL_ALERT_TTL_SECONDS
  }).catch(() => {});
}

const BOOK_SLOT_RE = /\[BOOK_SLOT:([^\]]+)\]/;
const OFFER_SLOTS_RE = /\[OFFER_SLOTS\]/;
const ESCALATE_RE = /\[ESCALATE\]/;
const ESCALATION_MESSAGE = "حولت طلبك لفريقنا، بيردون عليك قريب 🙌";
const SAFETY_NET_THRESHOLD = 3;
const SAFETY_NET_WINDOW_MINUTES = 60;
// How long the bot stays quiet on a phone after a human manually replies
// from the WhatsApp Business app, so it doesn't talk over them mid-handoff.
const HUMAN_SILENCE_WINDOW_MS = 2 * 3600 * 1000;

const DISABLE_ESCALATION_GATES = false;

// Cross-channel memory bridge: functions/_lib/domain/support.js embeds this line
// in the WhatsApp opener it pre-fills for a "continue on WhatsApp" handoff (see
// its file header). Matching it here lets the FIRST WhatsApp message from
// that visitor pull the full website conversation context back up instead
// of starting cold. Token-scoped lookup (getOmnichannelSession with
// sessionToken) — not the phone, which isn't known until this exact message
// arrives, so a phone-only lookup can never find a session created from the
// website side.
const SESSION_CODE_RE = /مرجع المحادثة:\s*([A-Z0-9]{6,10})/;

/**
 * `isAuraLine` = this message arrived on Aura's own support number, so the bot
 * speaks as Hala-the-vendor (consultation booking, escalation to our team).
 * Anything else is a merchant's own connected number, where the bot speaks as
 * THAT store's assistant. Previously this was a literal `merchantId === "hala"`
 * check in seven places, which silently made every merchant Aura.
 */
export async function autoReply(env, { merchantId, isAuraLine, phone, incomingText, contactName, context, requestId }) {
  if (!DISABLE_ESCALATION_GATES) {
    const lastHumanReplyAt = env.DB ? await getLastHumanReplyAt(env, merchantId, phone).catch(() => null) : null;
    if (lastHumanReplyAt && Date.now() - new Date(`${lastHumanReplyAt}Z`).getTime() < HUMAN_SILENCE_WINDOW_MS) {
      return null;
    }

    if (env.DB && isAuraLine) {
      const unresolvedCount = await countRecentInboundWithoutResolution(
        env,
        merchantId,
        phone,
        SAFETY_NET_WINDOW_MINUTES
      ).catch(() => 0);
      if (unresolvedCount >= SAFETY_NET_THRESHOLD) {
        return { text: ESCALATION_MESSAGE, offerSlots: false, escalate: true };
      }
    }
  }

  const history = env.DB ? await recentWaHistory(env, merchantId, phone).catch(() => []) : [];

  // Canned-reply fast path: a plain greeting on the FIRST turn of a
  // conversation costs nothing and answers faster than a model round-trip.
  // Scoped to history.length === 0 so it never talks over an ongoing
  // conversation where "هلا" appears mid-message. Skips quota consumption
  // entirely — no AI call was made, so nothing should be metered.
  if (history.length === 0) {
    const canned = isAuraLine
      ? matchAuraGreeting(incomingText)
      : matchFastIntent(incomingText, "saudi_najdi", { greetingOnly: true });
    if (canned) {
      return { text: canned, offerSlots: false, escalate: false };
    }
  }

  // Only the first turn of a conversation can carry a fresh handoff code —
  // checking every turn would let a customer paste an old/foreign code
  // mid-conversation and reset context they've already built with THIS bot.
  let omniSession = null;
  if (env.DB && history.length === 0) {
    const sessionCode = SESSION_CODE_RE.exec(incomingText)?.[1] || null;
    if (sessionCode) {
      omniSession = await getOmnichannelSession(env, { sessionToken: sessionCode, merchantId }).catch(() => null);
      if (omniSession) {
        incomingText = incomingText.replace(SESSION_CODE_RE, "").trim();
        // Backfill phone so a RETURN visit can be found by phone alone —
        // this first lookup only worked via the token because the row was
        // created (by domain/support.js) before we knew the visitor's WA number.
        await saveOmnichannelSession(env, { sessionToken: sessionCode, merchantId, phone }).catch(() => {});
      } else {
        logError(context, {
          requestId,
          path: "whatsapp/webhook:omnichannel_bridge",
          code: "SESSION_CODE_NOT_FOUND",
          internal: `code=${sessionCode}`,
          storeId: merchantId
        });
      }
    }
  }

  // Merchant monthly message quota (docs/ROADMAP.md m2.2.5) — this path had zero
  // metering before, unlike chat.js/copy.js. "hala" is exempt inside the helper.
  // Quota-exhausted degrades to the same handoff message as an escalation — the
  // END CUSTOMER shouldn't see a "your quota ran out" error, that's the
  // merchant's problem to know about (surfaced via the dashboard usage widget),
  // not something to expose mid-conversation to their customer.
  //
  // Manager decision 2026-09-06: a failed quota CHECK (D1/KV outage, not an
  // exhausted quota) fails OPEN on purpose — see file-header note. Every such
  // failure is logged and counted; ≥5 in 10 minutes flags healthcheck.js.
  const quota = env.DB
    ? await checkAndConsumeMonthly(env, merchantId, "message").catch(async (err) => {
        logError(context, {
          requestId,
          path: "whatsapp/webhook:quota_check",
          code: "QUOTA_CHECK_FAILED",
          internal: err && err.message,
          storeId: merchantId
        });
        const window = await checkRateLimit(env, "system", "wa_quota_check_failure", 5, 600);
        if (!window.allowed) await flagQuotaCheckDegraded(env);
        return { ok: true };
      })
    : { ok: true };
  if (!quota.ok) {
    return { text: ESCALATION_MESSAGE, offerSlots: false, escalate: true };
  }
  // Aura's own knowledge is baked into HALA_WHATSAPP_SUPPORT_PROMPT directly, so
  // skip the RAG round-trip (embedding + Vectorize query) for that branch — it's
  // pure latency with nothing to add, and this path is on a tight response-time
  // budget (WhatsApp, not a website widget where a couple extra seconds is fine).
  const memories =
    isAuraLine ? [] : await recallSimilar({ env, storeId: merchantId, question: incomingText }).catch(() => []);
  // A2 — المقتطفات المسترجعة نصوص كتبها عملاء سابقون؛ داخل محدِّدات صريحة.
  // `formatMemory` بدل `m.question`/`m.reply`: متجهات التاجر تحمل `{text}` فقط،
  // فكانت ذاكرة كل تاجر تصل النموذج «س: undefined ج: undefined» — أي أن مسار
  // RAG بواتساب كان يضيف ضجيجاً بدل معرفة.
  const ragFenced = fenceUntrusted(
    "معرفة مسترجعة",
    memories
      .map((m) => formatMemory(m))
      .filter(Boolean)
      .map((t) => `- ${t.replace(/\n/g, "\n  ")}`)
      .join("\n"),
    3000
  );
  const ragContext = ragFenced
    ? `\n\n## معرفة ذات صلة (استخدميها لو تساعد بالإجابة، تجاهليها لو مو مرتبطة)\n${ragFenced}`
    : "";

  // A2 — `chat_summary` هو **نص زائر مجهول** جاء من ودجت الموقع (domain/support.js
  // يحفظ آخر رسالة الزائر حرفياً). كان يُلصق داخل برومبت النظام بلا أي فاصل،
  // فسطر "تجاهل التعليمات السابقة…" بداخله يُقرأ أمراً. صار بيانات مسوّرة.
  let omniContext = "";
  if (omniSession) {
    const omniFenced = fenceUntrusted(
      "ذاكرة العميل من شات الموقع",
      [
        `ملخص محادثة الموقع: ${omniSession.chat_summary || "تصفح واستفسر عن منتجات"}`,
        `المنتج الناقشه بالموقع: ${omniSession.last_product || "غير محدد"}`,
        `طبيعة المحادثة: ${omniSession.theme_category || "استفسار ومبيعات"}`
      ].join("\n"),
      1200
    );
    omniContext = `\n\n## ذاكرة العميل من شات الموقع\n${omniFenced}\nتذكري العميل برحابة صدر، رحبي به واذكري أنك تذكرين استفساره بالموقع بلهجة سعودية دافئة!`;
  }

  // سطر التوضيح يُحقن مرة واحدة فقط حين توجد محدِّدات فعلاً — بلا بيانات
  // خارجية لا معنى لقاعدة عنها.
  const untrustedNotice = ragContext || omniContext ? `\n\n${UNTRUSTED_DATA_NOTICE}` : "";

  // شخصية الوكيل من بيانات التاجر (agent_profiles) — نفس الصف الذي يخدم ودجت
  // الموقع، فتبقى الشخصية واحدة عبر القناتين بدل نسختين تتباعدان (قاعدة M2).
  const agentProfile = env.DB ? await getAgentProfile(env, merchantId).catch(() => null) : null;
  // قراءة سياق التاجر لازمة فقط للفرع الثالث (لا وكيل ولا خط أورا) — نفس
  // الشرط الأصلي حرفياً حتى لا يُضاف استعلام D1 لم يكن موجوداً.
  const marketingContext =
    !agentProfile && !isAuraLine && env.DB ? await getMarketingContext(env, merchantId).catch(() => null) : null;

  const system = buildWhatsappSystem({
    agentProfile,
    isAuraLine,
    untrustedNotice,
    ragContext,
    omniContext,
    marketingContext
  });

  const turns = history
    .map((m) => ({ role: m.direction === "in" ? "user" : "assistant", content: m.body }))
    .concat([{ role: "user", content: incomingText }])
    .slice(-8);

  let reply = await askWorkersAI({
    env,
    system,
    messages: turns,
    maxTokens: isAuraLine ? 180 : 250,
    model: TEXT_MODEL,
    storeId: merchantId, // without this the reply lands in a cache bucket shared by every merchant
    ttlKind: "chat" // A9 — محادثة حية: ١٥ دقيقة، لا ٢٤ ساعة
  });

  // A1 — حارس الأسعار على واتساب. كان غائباً تماماً هنا رغم أن §٨ تمنع خط
  // أورا من ذكر أي رقم سعر منعاً باتاً، والتاجر الذي ضبط `allow_prices=0`
  // اختار الشيء نفسه لوكيله. الحارس يحذف الجملة المخالفة وحدها ويسجّل الحدث
  // بلا نص الرسالة (قاعدة errorLog.js).
  const blockPrices = agentProfile ? Number(agentProfile.allow_prices) === 0 : isAuraLine;
  if (blockPrices) {
    const guard = stripFabricatedPricing(reply);
    if (guard.stripped) {
      logError(context, {
        requestId,
        path: "whatsapp/webhook:price_guard",
        code: "PRICE_STRIPPED",
        internal: "fabricated price removed from model reply",
        storeId: merchantId
      });
    }
    reply = guard.text;
  }

  if (isAuraLine && ESCALATE_RE.test(reply)) {
    return { text: ESCALATION_MESSAGE, offerSlots: false, escalate: true };
  }

  let offerSlots = false;
  if (isAuraLine && OFFER_SLOTS_RE.test(reply)) {
    offerSlots = true;
    reply = reply.replace(OFFER_SLOTS_RE, "").trim();
  }

  const bookMatch = reply.match(BOOK_SLOT_RE);
  if (bookMatch && isAuraLine) {
    const slotLabel = bookMatch[1].trim();
    const booking = await saveConsultationBooking(env, { name: contactName || null, phone, slotLabel }).catch(() => null);
    reply = reply.replace(BOOK_SLOT_RE, "").trim();
    if (booking) reply += `\n\nرقم تذكرتك: ${booking.ticketCode} — احتفظ فيه لو رجعت تسأل عن الاستشارة.`;
  }

  return { text: reply, offerSlots, escalate: false };
}

// مجال المحادثة عبر القنوات (`omnichannel_sessions`): ما يربط جلسة الويدجت
// برقم واتساب لنفس العميل داخل متجر واحد.
// نُقل من core/db.js بالمرحلة ٣ بلا تغيير سلوكي.
import { askWorkersAI } from "../ai/gateway.js";
import { buildChatSystem } from "../ai/prompts/chat.js";
import { recallSimilar } from "../ai/memory.js";
import { parseModelJson } from "../ai/parseModelJson.js";
import { getMarketingContext } from "./persona.js";


export async function saveOmnichannelSession(env, { sessionToken, merchantId, phone, name, lastProduct, chatSummary, themeCategory }) {
  // secret-plaintext-ok: `session_token` **مفتاح أساسي للبحث** لا اعتماد —
  // معرّف جلسة ويدجت يولّده المتصفح ويُستعلَم به (`WHERE session_token = ?`).
  // تشفيره بـAES-GCM يعطي ناتجاً مختلفاً كل مرة فيكسر البحث، ولا يحمي شيئاً:
  // ليس بيانات اعتماد لطرف ثالث، والوصول للصف محروس بـmerchant_id أصلاً.
  await env.DB.prepare(
    `INSERT INTO omnichannel_sessions (session_token, merchant_id, phone, name, last_product, chat_summary, theme_category)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (session_token) DO UPDATE SET
       phone = COALESCE(excluded.phone, phone),
       name = COALESCE(excluded.name, name),
       last_product = COALESCE(excluded.last_product, last_product),
       chat_summary = COALESCE(excluded.chat_summary, chat_summary),
       theme_category = COALESCE(excluded.theme_category, theme_category),
       updated_at = datetime('now')
     WHERE omnichannel_sessions.merchant_id = excluded.merchant_id`
  )
    .bind(
      sessionToken,
      merchantId,
      phone || null,
      name || null,
      lastProduct ? JSON.stringify(lastProduct) : null,
      chatSummary || null,
      themeCategory || null
    )
    .run();
}

/**
 * Phone lookups MUST pass merchantId. A phone number is not tenant-scoped — the
 * same Saudi shopper routinely buys from several Salla stores, and every one of
 * them may be on Hala. Without the merchant filter this returned whichever store
 * that number spoke to most recently, so merchant B's bot loaded merchant A's
 * last_product / chat_summary and built its reply on them (2026-09-05 audit).
 * The write path (saveOmnichannelSession) already carried a merchant guard on
 * its UPDATE; only this read was missing one.
 *
 * The sessionToken path is scoped by the token itself (unguessable, one merchant),
 * but still verifies merchantId when the caller knows it — defence in depth.
 */
export async function getOmnichannelSession(env, { sessionToken, phone, merchantId }) {
  if (sessionToken) {
    // tenant-audit-ok: token-scoped (see docstring above) + merchantId
    // cross-check two lines below when the caller supplies one.
    const row = await env.DB.prepare("SELECT * FROM omnichannel_sessions WHERE session_token = ?")
      .bind(sessionToken)
      .first();
    if (row && merchantId && row.merchant_id !== merchantId) return null;
    return row;
  } else if (phone) {
    if (!merchantId) return null; // fail closed rather than crossing tenants
    return env.DB.prepare(
      "SELECT * FROM omnichannel_sessions WHERE phone = ? AND merchant_id = ? ORDER BY created_at DESC LIMIT 1"
    )
      .bind(phone, merchantId)
      .first();
  }
  return null;
}

// ── معاينة بوت التاجر (`POST /api/chat`) ────────────────────────────────────
// نُقل من `api/chat.js` بالمرحلة ٤ (ARCHITECTURE §٢) بلا تغيير سلوكي: نفس
// الترتيب، نفس النصوص، نفس شكل الرد. الفرق الوحيد أن انتزاع الـJSON صار عبر
// `ai/parseModelJson.js` (متوازن الأقواس) بدل regex جشع كان يبتلع أول `{`
// حتى آخر `}` بالمخرج.
const SAFE_FALLBACK = {
  saudi_najdi: "أبشر، وصلتني رسالتك! خلني أتأكد من التفاصيل وأرجع لك بأسرع وقت.",
  saudi_hijazi: "يا هلا فيك! وصلتني رسالتك، خليني أتأكد من التفاصيل وأرجع لك حالاً.",
  fusha_friendly: "شكراً على تواصلك! وصلتني رسالتك وسأتأكد من التفاصيل وأعود إليك قريباً."
};

/**
 * Real store knowledge for grounded replies: synced products from D1.
 * Empty array when nothing is synced — persona rules already forbid
 * inventing prices/products not in context.
 */
async function loadStoreProducts(env, storeId) {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT external_id, title, price, stock FROM product_sync
       WHERE merchant_id = ? ORDER BY last_sync_at DESC LIMIT 15`
    )
      .bind(storeId)
      .all();
    return results || [];
  } catch {
    return [];
  }
}

/**
 * رد المعاينة كاملاً: استرجاع (RAG + منتجات D1 + تعليمات محفوظة) ← بناء
 * النظام ← تمريرة نموذج واحدة ← تنقية ← جلسة عبر القنوات عند نية الشراء.
 * لا يعرف HTTP: يرجّع كائن بيانات، و`api/chat.js` يضيف `remaining` ويردّ.
 */
export async function replyToVisitor(env, { storeId, messages, botDialect, dialect: bodyDialect, sessionCode: bodySessionCode }) {
  const incoming = Array.isArray(messages) ? messages : [];
  let lastUserIndex = -1;
  for (let i = incoming.length - 1; i >= 0; i--) {
    if (incoming[i] && incoming[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  const message = lastUserIndex >= 0 ? String(incoming[lastUserIndex].content || "").trim().slice(0, 1000) : "";
  const priorTurns = incoming
    .slice(0, lastUserIndex)
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-6)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 500) }));

  if (!message) {
    return { error: "ما فيه رسالة عميل مرسلة." };
  }

  // Fire all three D1/Vectorize reads in parallel — nothing here depends on
  // each other, so running sequentially was pure wasted latency (~60ms saved).
  const [saved, examples, products] = await Promise.all([
    env.DB ? getMarketingContext(env, storeId).catch(() => null) : Promise.resolve(null),
    recallSimilar({ env, storeId, question: message, topK: 3 }).catch(() => []),
    loadStoreProducts(env, storeId)
  ]);

  const dialect = (saved && saved.dialect) || botDialect || bodyDialect || "saudi_najdi";
  // Only DB-saved instructions are trusted as system-prompt content. Never fall
  // back to client-supplied body fields here — that let any caller inject
  // arbitrary "system instructions" into the persona prompt (SECURITY_AUDIT
  // 2026-09-06, P24). No frontend ever sent botInstructions/storeInstructions;
  // dropping it is a pure fix, not a feature loss.
  const storeInstructions = ((saved && saved.instructions) || "").toString().slice(0, 2000);

  const system = buildChatSystem({ dialect, storeInstructions, examples, products });

  // Ultra-fast single-pass generation (1-Hop): persona, dialect, constraints and
  // product knowledge are pre-baked into the system prompt.
  const rawAiOutput = await askWorkersAI({
    env,
    system,
    messages: [...priorTurns, { role: "user", content: message }],
    maxTokens: 600,
    storeId,
    ttlKind: "chat" // A9 — معاينة محادثة: ١٥ دقيقة، لا ٢٤ ساعة
  });

  let reply = rawAiOutput;
  let summary = "";
  let discussedProduct = "";
  let theme = "";
  let isBuyIntent = false;
  let customerName = "";

  const parsed = parseModelJson(rawAiOutput);
  if (parsed && parsed.reply) {
    reply = String(parsed.reply);
    summary = String(parsed.summary || "");
    discussedProduct = String(parsed.discussedProduct || "");
    theme = String(parsed.theme || "");
    isBuyIntent = parsed.isBuyIntent === true;
    customerName = String(parsed.customerName || "");
  }

  // Safety floor check: fallback if reply is empty or failed
  if (!reply || typeof reply !== "string" || !reply.trim() || reply.trim().startsWith("{")) {
    reply = SAFE_FALLBACK[dialect] || SAFE_FALLBACK.saudi_najdi;
  }

  let whatsappTransitionUrl = null;
  // كان هنا كوبون **مختلَق** يُبنى من اسم العميل بصيغة ثابتة ويُرسَل له
  // برسالة واتساب جاهزة. هذا الكود غير موجود بأي متجر سلة — لم يُنشأ قط عبر
  // أي API، ولا يملك النظام صلاحية `marketing.read_write` أصلاً. العميل
  // يوصل الدفع فيُرفض الكود، والتاجر يتحمّل النتيجة.
  //
  // يخالف AGENT.md §الصدق حرفياً ("لا أكواد خصم مخترعة") وينطبق عليه معيار
  // **Q1** بـdocs/DEFERRED.md — مخرج مفبرك يصل عميلاً، فلا يُؤجَّل.
  // أُزيل 2026-09-08. الكوبون الحصري الحقيقي (طلب صاحب المشروع) يُبنى عبر
  // `POST /admin/v2/coupons` بـ`usage_limit_per_user` و`expiry_date` — ميزة
  // صادرة تمرّ ببوابة P10، لا سطراً يُلصق هنا.
  const personalCoupon = null;

  if (isBuyIntent) {
    const sessionCode = bodySessionCode || crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();

    // بلا رقم مضبوط لا رابط. الافتراضي السابق كان رقماً وهمياً مكتوباً
    // بالشيفرة يُرسَل لعملاء حقيقيين — ونفس قاعدة الأسرار تنطبق:
    // غياب القيمة = لا ميزة، لا قيمة افتراضية مخترعة.
    const waPhone = String(env.STORE_WA_PHONE || "").replace(/[^\d]/g, "");
    if (waPhone) {
      const waMessage = encodeURIComponent(`مرحباً، أبغى أكمل الشراء. كود الجلسة: ${sessionCode}`);
      whatsappTransitionUrl = `https://wa.me/${waPhone}?text=${waMessage}`;
    }

    await saveOmnichannelSession(env, {
      merchantId: storeId,
      sessionToken: sessionCode,
      chatSummary: summary,
      lastProduct: discussedProduct,
      themeCategory: theme
    });
  }

  return {
    result: reply,
    reply,
    dialect,
    whatsappTransitionUrl,
    personalCoupon,
    // A3 — حُذفت أربعة حقول جودة كانت قيماً ثابتة بالكود (درجة تسعة دائماً،
    // وثلاثة أعلام false) تدّعي حلقة نقد وتحسين وحارس وحفظ بالذاكرة لا وجود
    // لأي منها. ادعاء نظام غير موجود = بيانات مفبركة (AGENT.md §١١).
    usedMemoryExamples: examples.length,
    // للمستدعي فقط: `api/chat.js` يحوّلها لـ`debug` خلف علم البيئة ولا يسرّبها.
    examples
  };
}

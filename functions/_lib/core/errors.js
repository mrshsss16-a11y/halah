// كتالوج الأخطاء المركزي (D4 — docs/PARALLEL_TRACKS.md §أ.٤).
//
// المشكلة التي يحلّها: كل عطل غير متوقَّع كان يصل التاجر برسالة واحدة عامة
// ("صار خلل مؤقت أثناء المعالجة") مهما اختلف سببه — مزود AI ساقط، أو قاعدة
// بيانات، أو حصة، أو شبكة. الرسالة الواحدة تُخفي الفرق بين "انتظر دقيقة"
// و"راجع إعداداتك" و"تواصل معنا" — فيتصل التاجر بالدعم في الحالات الثلاث.
//
// القاعدة (M5): العميل يرى عربية واضحة تقول **ماذا يفعل الآن**؛ والسجل يرى
// التفصيل التقني. لا كود HTTP خام ولا رسالة إنجليزية تصل تاجراً أبداً.
//
// ⚠️ ما لا تغطيه هذه الوحدة (صريح): نقاط الاتصال آلة-بآلة — ويبهوك سلة
// وويبهوك واتساب — تبقى رسائلها إنجليزية مقتضبة عمداً ("invalid signature").
// المستقبِل هناك خادم Meta/سلة لا إنسان، والتعريب يضرّ التشخيص ولا ينفع أحداً.

/**
 * خطأ **مجالي** — يرميه `functions/_lib/domain/**` بدل `ApiError`.
 *
 * لماذا هنا لا بـ`respond.js`: قاعدة الاتجاه ق٣ (ARCHITECTURE §١) تمنع المجال
 * من استيراد `respond.js` — المجال لا يعرف HTTP ولا `Response`. لكنه يعرف
 * **ماذا يقول للعميل** و**بأي حالة**، فيحمل الاثنين كبيانات ويترجمها `withApi`
 * إلى نفس شكل استجابة `ApiError` بالضبط: `{ ok:false, error, code, requestId }`
 * بنفس الحالة — لا يتغيّر شيء على العميل.
 *
 * `userMessage` هو ما يصل التاجر (عربي، آمن للعرض). `internal` للسجل فقط،
 * لا يُرسل أبداً. لا PII بأيّهما (هاتف، بريد، نص رسالة).
 */
export class DomainError extends Error {
  constructor(status, userMessage, code = "ERROR", internal = null) {
    super(userMessage);
    this.name = "DomainError";
    this.status = status;
    this.code = code;
    this.userMessage = userMessage;
    this.internal = internal;
  }
}

/**
 * كل مدخل: الحالة HTTP + رسالة عربية موجّهة للفعل، لا لوصف العطل.
 * `action` ليست زخرفة: هي الفرق بين رسالة تُنهي المشكلة وأخرى تُنتج تذكرة دعم.
 */
export const ERROR_CATALOG = {
  // ── الحصص والاستهلاك ──
  QUOTA_EXCEEDED: {
    status: 429,
    message: "خلصت حصتك لهذا الشهر. تتجدد تلقائياً أول الشهر الجاي."
  },
  RATE_LIMITED: {
    status: 429,
    message: "طلبات كثيرة بوقت قصير. انتظر دقيقة وحاول مرة ثانية."
  },

  // ── المصادقة والصلاحيات ──
  LOGIN_REQUIRED: {
    status: 401,
    message: "لازم تسجّل دخولك أول."
  },
  FORBIDDEN: {
    status: 403,
    message: "ما عندك صلاحية لهذا الإجراء."
  },

  // ── مزودو الذكاء الاصطناعي ──
  // مقصودة التمييز: "مشغول" يعني أعِد المحاولة، و"غير مهيّأ" يعني عطل عندنا
  // لا فائدة من إعادة المحاولة فيه — خلطهما يجعل التاجر يكرر بلا طائل.
  AI_BUSY: {
    status: 503,
    message: "خدمة الذكاء الاصطناعي مزحومة حالياً. جرّب بعد دقيقة."
  },
  AI_UNAVAILABLE: {
    status: 503,
    message: "خدمة الذكاء الاصطناعي متوقفة مؤقتاً عندنا. فريقنا منتبه للموضوع — جرّب بعد شوي."
  },
  // كل المزوّدين بلغوا حدهم **اليومي** (2026-09-12 05:35 UTC): «جرّب بعد دقيقة» كانت تُكرِّر طلباً لن ينجح.
  AI_QUOTA_DAILY: {
    status: 503,
    message: "خلصت سعة الذكاء الاصطناعي المتاحة لهذا اليوم. تتجدد تلقائياً خلال ساعات — جرّب لاحقاً، وما ضاع شي."
  },

  // ── التخزين والمزامنة ──
  DB_UNAVAILABLE: {
    status: 503,
    message: "تعذّر الوصول لبياناتك حالياً. جرّب بعد شوي — ما ضاع شي."
  },
  SYNC_FAILED: {
    status: 502,
    message: "تعذّرت المزامنة مع متجرك. تأكد أن الربط ما زال فعّالاً من صفحة الإعدادات."
  },
  STORE_NOT_CONNECTED: {
    status: 400,
    message: "متجرك غير مربوط بعد. اربطه من صفحة الإعدادات عشان تشتغل هذي الميزة."
  },

  // ── المدخلات ──
  INVALID_INPUT: {
    status: 400,
    message: "البيانات المرسلة ناقصة أو غير صحيحة. راجع الحقول وحاول مرة ثانية."
  },

  // ── الملاذ الأخير ──
  INTERNAL: {
    status: 500,
    message: "صار خلل غير متوقع عندنا. لو تكرر، أرسل لنا رقم الطلب الظاهر بالأسفل."
  }
};

/**
 * تصنيف خطأ خام (غير مُصنَّف) إلى كود من الكتالوج.
 *
 * ⚠️ حدّ الأداة (قاعدة م٥ — docs/AGENT_ORCHESTRATION.md): التصنيف يقرأ **نص**
 * رسالة الخطأ، وهو أهشّ من فحص نوعه. رسالة مزوّد تتغيّر = تصنيف يعود
 * INTERNAL. لذلك INTERNAL ليس فشلاً للأداة بل سلوكها الافتراضي الآمن:
 * رسالة صحيحة وإن كانت أعمّ، لا رسالة خاطئة واثقة. أي مسار يحتاج دقة مضمونة
 * يرمي ApiError بكوده صراحةً بدل الاعتماد على هذا التخمين.
 */
export function classifyError(err) {
  const raw = String(err?.message || err || "");

  // ترتيب الفحص مقصود: الأضيق أولاً. "AI binding is missing" تحتوي كلمة AI
  // وكذلك "No AI backend available" — لكن الأولى عطل تهيئة والثانية كذلك،
  // بينما 429 من مزود خارجي حالة مختلفة تماماً (مزحوم، لا معطّل).
  // حدّ يومي عند مزوّد على الأقل، ولا مزوّد محدود بالدقيقة فقط ⇒ لا فائدة من إعادة المحاولة بعد دقيقة.
  // رسالة البوابة تجمع أسباب كل المزوّدين مفصولة بـ« | » (gateway.js).
  const parts = raw.split(" | ");
  const DAILY = /free-models-per-day|tokens per day|\(TPD\)|requests per day|\(RPD\)|daily free allocation|PerDay|per_day|(?<!\d)4006(?!\d)/i;
  const MINUTE = /\b429\b|rate.?limit|too many requests|per minute|PerMinute|\((?:I|O)?TPM\)|\(RPM\)/i;
  if (parts.some((x) => DAILY.test(x)) && !parts.some((x) => MINUTE.test(x) && !DAILY.test(x))) return "AI_QUOTA_DAILY";
  if (/\b429\b|rate.?limit|too many requests/i.test(raw)) return "AI_BUSY";
  if (/No AI backend available|AI binding is missing/i.test(raw)) return "AI_UNAVAILABLE";
  if (/Groq |OpenRouter |DeepSeek |Workers AI|all four ai tiers/i.test(raw)) return "AI_UNAVAILABLE";
  if (/D1_|database|sqlite|no such table/i.test(raw)) return "DB_UNAVAILABLE";
  if (/fetch failed|network|ETIMEDOUT|ECONNRESET/i.test(raw)) return "SYNC_FAILED";

  return "INTERNAL";
}

/** الرسالة العربية لكود، مع ارتداد آمن لو الكود غير معروف. */
export function messageFor(code) {
  return (ERROR_CATALOG[code] || ERROR_CATALOG.INTERNAL).message;
}

/** الحالة HTTP لكود، مع ارتداد آمن. */
export function statusFor(code) {
  return (ERROR_CATALOG[code] || ERROR_CATALOG.INTERNAL).status;
}

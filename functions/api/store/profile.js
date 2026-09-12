// POST /api/store/profile — body: { storeId, action: 'get' | 'rebuild' | 'approve', profile?, reviewId? }
//
// المرحلة ٣ (② PROFILE) من docs/PLAN_BULK_SEO.md — بصمة المتجر: المرساة التي
// تثبّت أسلوب ٢٠٠ وصف. كل منطق D1 بـ_lib/services/storeProfile.js (معيار M1)؛
// هذا الملف بوابة HTTP فقط: مصادقة، حصة، سقف معدل، توجيه الفعل.
import { withApi } from "../../_lib/core/respond.js";
import { requireCompletedAccount } from "../../_lib/core/session.js";
import { checkRateLimit, clientIp } from "../../_lib/core/rateLimit.js";
import { checkAndConsumeMonthly } from "../../_lib/core/meter.js";
import { buildProfile, getProfile, approveProfile } from "../../_lib/domain/storeProfile.js";

const ACTIONS = new Set(["get", "rebuild", "approve"]);

async function profileHandler(body, env, request) {
  // البناء يستدعي النموذج على عيّنة ٤٠ منتج — أثقل استدعاء نصي بالمشروع.
  // سقف صارم (٣ محاولات / ١٠ دقائق) قبل أي عمل، وقبل حلّ هوية المتجر: هذا
  // المسار المكلف الذي يستهدفه المهاجم المجهول (نفس منطق copy.js).
  const rl = await checkRateLimit(env, clientIp(request), "store_profile", 3, 600);
  if (!rl.allowed) {
    return { ok: false, error: `محاولات كثيرة. حاول بعد ${rl.resetInSeconds} ثانية.`, code: "RATE_LIMITED" };
  }

  const merchantId = await requireCompletedAccount(request, env, body.storeId);

  const action = ACTIONS.has(body.action) ? body.action : "get";

  if (action === "get") {
    const current = await getProfile(env, { merchantId });
    return { ok: true, ...current };
  }

  if (action === "approve") {
    // reviewedBy من الجلسة لا من العميل (الخطة §٤). البصمة تُعتمد باسم التاجر
    // صاحب الجلسة، ولو مرّر `profile` فهي نسخته المعدّلة وتمرّ بالتطبيع.
    const approved = await approveProfile(env, {
      merchantId,
      profile: body.profile && typeof body.profile === "object" ? body.profile : null,
      reviewId: Number.isInteger(Number(body.reviewId)) && Number(body.reviewId) > 0 ? Number(body.reviewId) : null,
      reviewedBy: merchantId
    });
    return { ok: true, ...approved, message: "اعتُمدت بصمة متجرك — بتنطبق على كل وصف جديد." };
  }

  // ── rebuild ────────────────────────────────────────────────────────────────
  // الحصة: **استدعاء واحد لكل متجر، لا ٤٠**. العيّنة كلها تُرسَل داخل رسالة
  // واحدة لنداء نموذج واحد، فالخصم واحد.
  //
  // لماذا بكت `message` لا `description`:
  // بكت `description` (٥/يوم) هو الوعد الظاهر للتاجر — "٥ أوصاف يومياً". خصم
  // البصمة منه يحوّل بصمت وصفَ منتج موعوداً إلى بنية تحتية، وهذا يخالف قاعدة
  // الصدق (AGENT.md §١١) على حساب التاجر، ويكسر حساب الخطة §٦ ("البصمة شبه
  // مجانية"). `message` (٣٠٠/شهر) هو بكت نداءات النموذج العامة وفيه متسع،
  // والبصمة نداء عام واحد لا وصف منتج. الحماية من الإساءة هنا هي سقف المعدل
  // أعلاه (٣/١٠ دقائق) لا الحصة.
  const usage = await checkAndConsumeMonthly(env, merchantId, "message");
  if (!usage.ok) {
    return {
      ok: false,
      error: "خلصت حصتك هالشهر — تتجدد أول الشهر الجاي.",
      code: "OUT_OF_CREDITS",
      remaining: 0
    };
  }

  const built = await buildProfile(env, { merchantId });
  return {
    ok: true,
    ...built,
    remaining: usage.remaining,
    // صدق بالمخرجات: البصمة **لا تُحقن** بالتوليد قبل الاعتماد.
    message: "جهّزنا مسودة بصمة متجرك. راجعها واعتمدها عشان تنطبق على الأوصاف."
  };
}

export const onRequestPost = withApi(profileHandler);

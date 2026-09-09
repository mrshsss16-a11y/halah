// مجال فحص الصحة الدوري (المرحلة ٤: نُقل من `api/cron/healthcheck.js` بلا
// تغيير سلوكي — نفس الفحوص، نفس مفاتيح KV، نفس نوافذ الخنق والتنبيه).
//
// لماذا هنا: هذه قرارات أعمال (ما الحرِج؟ متى ننبّه؟ كم مرة؟) لا تنسيق HTTP.
// نقطة الدخول تبقى حارس CRON_SECRET + استدعاء واحد.
import { assertWaUrlAllowed } from "../integrations/whatsapp.js";

const ALERT_DEDUPE_SECONDS = 3600; // إعادة التنبيه مرة/ساعة بينما العطل قائم
const WA_TOKEN_CHECK_THROTTLE_SECONDS = 3600; // O3: debug_token مرة/ساعة كحد أقصى
const SALLA_TOKEN_EXPIRY_WARNING_SECONDS = 3 * 24 * 60 * 60; // ٣ أيام

/**
 * O3 — صلاحية توكن واتساب. fail-closed: أي خطأ بالفحص نفسه (شبكة، رد غير
 * متوقع، توكن غائب) يُعامَل كتنبيه لا كتجاهل. لا PII: حالة التوكن فقط.
 */
export async function checkWaTokenValid(env) {
  if (!env.WHATSAPP_TOKEN) return { ok: false, reason: "WHATSAPP_TOKEN غير مضبوط" };
  try {
    const url = assertWaUrlAllowed(
      `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(env.WHATSAPP_TOKEN)}&access_token=${encodeURIComponent(env.WHATSAPP_TOKEN)}`
    );
    const res = await fetch(url);
    if (!res.ok) return { ok: false, reason: `debug_token HTTP ${res.status}` };
    const data = await res.json().catch(() => null);
    return data?.data?.is_valid === true ? { ok: true } : { ok: false, reason: "توكن واتساب غير صالح" };
  } catch (err) {
    return { ok: false, reason: `تعذّر فحص التوكن: ${String(err?.message || err).slice(0, 200)}` };
  }
}

/**
 * O3 — توكنات سلة القريبة من الانتهاء أو التي فشل تجديدها. بلا أي PII
 * (لا اسم متجر): المعرّف الداخلي والأيام المتبقية فقط.
 * tenant-audit-ok: مسح تشغيلي عابر للمتاجر بالتصميم (تنبيه أدمن مجمّع).
 */
export async function checkSallaTokenExpiry(env) {
  if (!env.DB) return { expiring: [], error: "DB غير متاح" };
  try {
    const nowS = Math.floor(Date.now() / 1000);
    const { results } = await env.DB.prepare(
      `SELECT merchant_id, expires_at, refresh_lock FROM oauth_tokens
       WHERE platform = 'salla' AND (expires_at - ?) < ?`
    )
      .bind(nowS, SALLA_TOKEN_EXPIRY_WARNING_SECONDS)
      .all();
    return {
      expiring: (results || []).map((r) => ({
        merchantId: r.merchant_id,
        daysLeft: Math.floor((r.expires_at - nowS) / 86400),
        refreshStuck: !!r.refresh_lock
      }))
    };
  } catch (err) {
    return { expiring: [], error: String(err?.message || err).slice(0, 200) };
  }
}

/** فحوص المسارات الحرِجة: D1، ربط AI الأساسي، وحالة فحص حصة الويبهوك. */
export async function runCriticalChecks(env) {
  const checks = { db: "unknown", ai_primary: "unknown", wa_quota_check: "unknown" };

  try {
    if (env.DB) {
      await env.DB.prepare("SELECT 1").first();
      checks.db = "ok";
    } else {
      checks.db = "missing";
    }
  } catch {
    checks.db = "error";
  }

  checks.ai_primary = env.AI ? "ok" : "missing";

  // يضبطه `api/whatsapp/webhook.js` حين يفشل فحص الحصة ≥٥ مرات بـ١٠ دقائق
  // (عطل D1/KV). الويبهوك يفشل **مفتوحاً** عمداً (AGENT.md §13 P28)؛ هذا هو
  // نصف الرؤية من ذاك القرار، لا إصلاحاً له.
  if (env.HALA_CACHE) {
    const degraded = await env.HALA_CACHE.get("wa_quota_check_degraded").catch(() => null);
    checks.wa_quota_check = degraded ? "degraded" : "ok";
  }

  const critical = Object.entries(checks).filter(([, v]) => v !== "ok");
  return { checks, critical, healthy: critical.length === 0 };
}

/** هل مفتاح الخنق/التجميع فارغ الآن؟ (وإن كان، يُختم فوراً بعمر النافذة). */
export async function claimAlertSlot(env, key, ttl = ALERT_DEDUPE_SECONDS) {
  if (!env.HALA_CACHE) return false;
  const last = await env.HALA_CACHE.get(key).catch(() => null);
  if (last) return false;
  await env.HALA_CACHE.put(key, new Date().toISOString(), { expirationTtl: ttl }).catch(() => {});
  return true;
}

/** يمسح ختم التنبيه بعد التعافي فيُنبّه العطل التالي فوراً. */
export async function clearAlertSlot(env, key) {
  if (!env.HALA_CACHE) return;
  await env.HALA_CACHE.delete(key).catch(() => {});
}

export const WA_TOKEN_THROTTLE_KEY = "wa_token_check_last_run";
export const WA_TOKEN_THROTTLE_SECONDS = WA_TOKEN_CHECK_THROTTLE_SECONDS;

// ── المرحلة ٤: فحوص `/api/health` العلنية (كانت بـ`api/health.js`) ──────────

// O2: أي وظيفة cron نبضها الأخير أقدم من هذا = "error" (توقف cron-worker).
const CRON_HEARTBEAT_STALE_MS = 25 * 60 * 1000;

// O1: هذه الفحوص وحدها تُسقط HTTP إلى 503 عند error/missing — بقيتها
// (مثل مزوّدي الاحتياط الاختياريين) معلوماتية فقط، غيابها ليس عطلاً.
const CRITICAL_CHECK_KEYS = ["db", "ai_primary", "cache"];

/** حالة نبض الـcron: الجدول غير المطبَّق "missing" لا "error". */
function cronStatus(heartbeats) {
  if (heartbeats === null || heartbeats.length === 0) return "missing";
  const now = Date.now();
  const stale = heartbeats.some((h) => {
    if (!h.last_run_at) return true;
    const ts = Date.parse(`${h.last_run_at}Z`);
    return !Number.isFinite(ts) || now - ts > CRON_HEARTBEAT_STALE_MS;
  });
  return stale || heartbeats.some((h) => h.last_ok === 0) ? "error" : "ok";
}

/** @returns {Promise<{checks: object, criticalDown: boolean}>} */
export async function publicHealthChecks(env, readHeartbeats) {
  const checks = {
    db: "unknown", cache: "unknown", vectorize: "unknown", cron: "unknown",
    ai_primary: "unknown", groq_fallback: "unknown", openrouter_fallback: "unknown"
  };

  try {
    if (env?.DB) {
      await env.DB.prepare("SELECT 1").first();
      checks.db = "ok";
    } else {
      checks.db = "missing";
    }
  } catch {
    checks.db = "error";
  }

  try {
    if (env?.HALA_CACHE) {
      await env.HALA_CACHE.get("ping");
      checks.cache = "ok";
    } else {
      checks.cache = "missing";
    }
  } catch {
    checks.cache = "error";
  }

  checks.vectorize = env?.VECTORIZE_INDEX ? "ok" : "missing";
  checks.ai_primary = env?.AI ? "ok" : "missing";
  checks.groq_fallback = env?.GROQ_API_KEY ? "ok" : "missing";
  checks.openrouter_fallback = env?.OPENROUTER_API_KEY ? "ok" : "missing";

  try {
    checks.cron = cronStatus(await readHeartbeats(env));
  } catch {
    checks.cron = "error";
  }

  return {
    checks,
    criticalDown: CRITICAL_CHECK_KEYS.some((k) => checks[k] === "error" || checks[k] === "missing")
  };
}

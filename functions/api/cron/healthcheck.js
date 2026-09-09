// GET /api/cron/healthcheck — pinged by the same standalone Worker as
// reminders.js (cron-worker/), every 10 minutes. Checks the critical paths
// (DB, primary AI binding) and sends one WhatsApp alert to the admin when
// something breaks — deduped via KV so an ongoing outage doesn't spam every
// 10 minutes, but re-alerts hourly if still down.
import { sendWaText, waConfigured, assertWaUrlAllowed } from "../../_lib/integrations/whatsapp.js";
import { timingSafeEqualStr } from "../../_lib/core/crypto.js";
import { generateRequestId } from "../../_lib/core/respond.js";
import { logError } from "../../_lib/core/errorLog.js";
import { recordHeartbeat } from "../../_lib/core/heartbeat.js";

const ALERT_DEDUPE_SECONDS = 3600; // re-alert at most once/hour while still down
const WA_TOKEN_CHECK_THROTTLE_SECONDS = 3600; // O3: لا نستدعي debug_token أكثر من مرة/ساعة
const SALLA_TOKEN_EXPIRY_WARNING_SECONDS = 3 * 24 * 60 * 60; // ٣ أيام

// O3: صلاحية توكن واتساب — fail-closed: أي خطأ بالفحص نفسه (شبكة، رد غير
// متوقع، توكن غائب) يُعامَل كتنبيه، لا كـ"تجاهل". لا PII هنا — لا أرقام
// جوال ولا نص محادثة، فقط حالة التوكن.
async function checkWaTokenValid(env) {
  if (!env.WHATSAPP_TOKEN) return { ok: false, reason: "WHATSAPP_TOKEN غير مضبوط" };
  try {
    const url = assertWaUrlAllowed(
      `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(env.WHATSAPP_TOKEN)}&access_token=${encodeURIComponent(env.WHATSAPP_TOKEN)}`
    );
    const res = await fetch(url);
    if (!res.ok) return { ok: false, reason: `debug_token HTTP ${res.status}` };
    const data = await res.json().catch(() => null);
    const isValid = data?.data?.is_valid === true;
    return isValid ? { ok: true } : { ok: false, reason: "توكن واتساب غير صالح" };
  } catch (err) {
    // fail-closed: خطأ بالفحص = تنبيه، لا تمرير برشاقة.
    return { ok: false, reason: `تعذّر فحص التوكن: ${String(err?.message || err).slice(0, 200)}` };
  }
}

// O3: توكنات سلة القريبة من الانتهاء أو التي فشل تجديدها — تنبيه مجمّع بلا
// أي PII (لا اسم متجر، فقط معرّف الحساب الداخلي وعدد الأيام المتبقية).
async function checkSallaTokenExpiry(env) {
  if (!env.DB) return { expiring: [], error: "DB غير متاح" };
  try {
    const nowS = Math.floor(Date.now() / 1000);
    const { results } = await env.DB.prepare(
      `SELECT merchant_id, expires_at, refresh_lock FROM oauth_tokens
       WHERE platform = 'salla' AND (expires_at - ?) < ?`
    )
      .bind(nowS, SALLA_TOKEN_EXPIRY_WARNING_SECONDS)
      .all();
    return { expiring: (results || []).map((r) => ({ merchantId: r.merchant_id, daysLeft: Math.floor((r.expires_at - nowS) / 86400), refreshStuck: !!r.refresh_lock })) };
  } catch (err) {
    return { expiring: [], error: String(err?.message || err).slice(0, 200) };
  }
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const requestId = generateRequestId();

  if (!env.CRON_SECRET) {
    logError(context, { requestId, path: "cron/healthcheck", code: "CRON_SECRET_MISSING", internal: "CRON_SECRET not configured" });
    return new Response(JSON.stringify({ ok: false, error: "فحص الصحة الدوري غير مفعّل حالياً على الخادم.", code: "CRON_NOT_CONFIGURED", requestId }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
  const authHeader = request.headers.get("Authorization") || "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!timingSafeEqualStr(provided, env.CRON_SECRET)) {
    return new Response(JSON.stringify({ ok: false, error: "غير مصرّح بهذا الطلب.", code: "UNAUTHORIZED", requestId }), {
      status: 401,
      headers: { "content-type": "application/json" }
    });
  }

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

  // Set by functions/api/whatsapp/webhook.js when the monthly quota check
  // fails ≥5 times in 10 minutes (D1/KV outage) — see docs/AGENT.md §13.
  // The webhook deliberately fails OPEN on this (keeps replying to every
  // merchant during a transient blip); this is the visibility half of that
  // decision, not a fix to the fail-open behavior itself.
  if (env.HALA_CACHE) {
    const degraded = await env.HALA_CACHE.get("wa_quota_check_degraded").catch(() => null);
    checks.wa_quota_check = degraded ? "degraded" : "ok";
  }

  const critical = Object.entries(checks).filter(([, v]) => v !== "ok");
  const healthy = critical.length === 0;

  if (!healthy && waConfigured(env) && env.HALA_CACHE) {
    const dedupeKey = "health_alert_last_sent";
    const lastSent = await env.HALA_CACHE.get(dedupeKey).catch(() => null);
    if (!lastSent) {
      const adminPhone = env.STORE_WA_PHONE || "966545149591";
      const failedList = critical.map(([k, v]) => `${k}: ${v}`).join("، ");
      await sendWaText(env, {
        to: adminPhone,
        body: `⚠️ تنبيه هالة: فحص صحة النظام لقى مشكلة — ${failedList}. تحقق فوراً.`
      }).catch(() => {});
      await env.HALA_CACHE.put(dedupeKey, new Date().toISOString(), { expirationTtl: ALERT_DEDUPE_SECONDS }).catch(() => {});
    }
  } else if (healthy && env.HALA_CACHE) {
    // Clear the dedupe flag once healthy again so the next real outage alerts immediately.
    await env.HALA_CACHE.delete("health_alert_last_sent").catch(() => {});
  }

  // O3: فحص صلاحية توكن واتساب — مخنوق بـKV مرة كل ساعة، مستقل عن dedupe
  // فحص الصحة الأساسي أعلاه (سبب تنبيه مختلف).
  let waTokenCheck = { ran: false };
  if (env.HALA_CACHE) {
    const throttleKey = "wa_token_check_last_run";
    const lastRun = await env.HALA_CACHE.get(throttleKey).catch(() => null);
    if (!lastRun) {
      const result = await checkWaTokenValid(env);
      waTokenCheck = { ran: true, ok: result.ok };
      await env.HALA_CACHE.put(throttleKey, new Date().toISOString(), { expirationTtl: WA_TOKEN_CHECK_THROTTLE_SECONDS }).catch(() => {});
      if (!result.ok) {
        logError(context, { requestId, path: "cron/healthcheck", code: "WA_TOKEN_INVALID", internal: result.reason });
        if (waConfigured(env)) {
          const dedupeKey = "wa_token_alert_last_sent";
          const lastAlert = await env.HALA_CACHE.get(dedupeKey).catch(() => null);
          if (!lastAlert) {
            const adminPhone = env.STORE_WA_PHONE || "966545149591";
            await sendWaText(env, {
              to: adminPhone,
              body: `⚠️ تنبيه هالة: توكن واتساب غير صالح أو تعذّر التحقق منه. جدّد التوكن من Meta Business Settings.`
            }).catch(() => {});
            await env.HALA_CACHE.put(dedupeKey, new Date().toISOString(), { expirationTtl: ALERT_DEDUPE_SECONDS }).catch(() => {});
          }
        }
      }
    }
  }

  // O3: توكنات سلة القريبة من الانتهاء — تنبيه مجمّع بلا PII، مخنوق ساعياً
  // بنفس آلية أعلاه.
  const sallaExpiry = await checkSallaTokenExpiry(env);
  if (sallaExpiry.expiring.length && waConfigured(env) && env.HALA_CACHE) {
    const dedupeKey = "salla_token_expiry_alert_last_sent";
    const lastAlert = await env.HALA_CACHE.get(dedupeKey).catch(() => null);
    if (!lastAlert) {
      const adminPhone = env.STORE_WA_PHONE || "966545149591";
      const count = sallaExpiry.expiring.length;
      await sendWaText(env, {
        to: adminPhone,
        body: `⚠️ تنبيه هالة: ${count} متجر سلة توكنه ينتهي خلال ٣ أيام أو تجديده فاشل. راجع /api/admin/overview.`
      }).catch(() => {});
      await env.HALA_CACHE.put(dedupeKey, new Date().toISOString(), { expirationTtl: ALERT_DEDUPE_SECONDS }).catch(() => {});
    }
  }

  await recordHeartbeat(env, { job: "healthcheck", ok: healthy, note: healthy ? null : critical.map(([k]) => k).join(",") });

  return new Response(JSON.stringify({ ok: true, healthy, checks, waTokenCheck, sallaTokenExpiring: sallaExpiry.expiring.length }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

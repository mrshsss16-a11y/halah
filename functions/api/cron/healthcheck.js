// GET /api/cron/healthcheck — pinged by the same standalone Worker as
// reminders.js (cron-worker/), every 10 minutes. Checks the critical paths
// (DB, primary AI binding) and sends one WhatsApp alert to the admin when
// something breaks — deduped via KV so an ongoing outage doesn't spam every
// 10 minutes, but re-alerts hourly if still down.
import { sendWaText, waConfigured } from "../../_lib/integrations/whatsapp.js";
import { timingSafeEqualStr } from "../../_lib/core/crypto.js";
import { generateRequestId } from "../../_lib/core/respond.js";
import { logError } from "../../_lib/core/errorLog.js";

const ALERT_DEDUPE_SECONDS = 3600; // re-alert at most once/hour while still down

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

  return new Response(JSON.stringify({ ok: true, healthy, checks }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

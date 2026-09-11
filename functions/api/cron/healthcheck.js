// GET /api/cron/healthcheck — يُضرب كل ١٠ دقائق من `cron-worker/`. يفحص
// المسارات الحرِجة (D1، ربط AI) ويرسل تنبيه واتساب واحداً للأدمن عند الخلل،
// مخنوقاً بـKV فلا يتكرر كل ١٠ دقائق أثناء عطل مستمر (إعادة تنبيه ساعية).
//
// المرحلة ٤: تنسيق فقط — الحارس بـ`withApi.raw({cron:true})` والفحوص بـ`domain/health.js`.
import { withApi } from "../../_lib/core/respond.js";
import {
  runCriticalChecks, checkWaTokenValid, checkSallaTokenExpiry, sendAdminAlert,
  claimAlertSlot, clearAlertSlot, WA_TOKEN_THROTTLE_KEY, WA_TOKEN_THROTTLE_SECONDS
} from "../../_lib/domain/health.js";
import { refreshExpiringIgTokens } from "../../_lib/domain/instagram.js";
import { syncHalaFaqEmbeddings } from "../../_lib/domain/faqSync.js";
import { pruneOldLogs } from "../../_lib/domain/retention.js";
import { logError } from "../../_lib/core/errorLog.js";
import { recordHeartbeat } from "../../_lib/core/heartbeat.js";

async function healthcheckHandler(request, env, requestId, context) {
  // ق٦: التنبيه نفسه (قناة + خنق + رقم الأدمن) بـ`domain/health.js`.
  const alert = (key, body) => sendAdminAlert(env, key, body);

  const { checks, critical, healthy } = await runCriticalChecks(env);

  if (!healthy) {
    await alert("health_alert_last_sent", `⚠️ تنبيه هالة: فحص صحة النظام لقى مشكلة — ${critical.map(([k, v]) => `${k}: ${v}`).join("، ")}. تحقق فوراً.`);
  } else {
    await clearAlertSlot(env, "health_alert_last_sent");
  }

  // O3 — فحص صلاحية توكن واتساب، مخنوق ساعياً ومستقل عن dedupe الفحص أعلاه.
  let waTokenCheck = { ran: false };
  if (await claimAlertSlot(env, WA_TOKEN_THROTTLE_KEY, WA_TOKEN_THROTTLE_SECONDS)) {
    const result = await checkWaTokenValid(env);
    waTokenCheck = { ran: true, ok: result.ok };
    if (!result.ok) {
      logError(context, { requestId, path: "cron/healthcheck", code: "WA_TOKEN_INVALID", internal: result.reason });
      await alert("wa_token_alert_last_sent", "⚠️ تنبيه هالة: توكن واتساب غير صالح أو تعذّر التحقق منه. جدّد التوكن من Meta Business Settings.");
    }
  }

  // O3 — توكنات سلة القريبة من الانتهاء: تنبيه مجمّع بلا PII، مخنوق ساعياً.
  const sallaExpiry = await checkSallaTokenExpiry(env);
  if (sallaExpiry.expiring.length) {
    await alert("salla_token_expiry_alert_last_sent", `⚠️ تنبيه هالة: ${sallaExpiry.expiring.length} متجر سلة توكنه ينتهي خلال ٣ أيام أو تجديده فاشل. راجع /api/admin/overview.`);
  }

  // توكن إنستغرام يعيش ٦٠ يوماً (INSTAGRAM_PLAN §٤.٢): بلا تجديد دوري يسقط
  // المسار صامتاً. لا صف مستحق ⇒ صفر نداء شبكة.
  const igTokens = await refreshExpiringIgTokens(env, context);
  if (igTokens.failed) {
    await alert("ig_token_refresh_alert_last_sent", `⚠️ تنبيه هالة: تعذّر تجديد ${igTokens.failed} توكن إنستغرام. راجع سجل الأخطاء (IG_TOKEN_REFRESH_FAILED).`);
  }

  // ذاكرة RAG لودجت الموقع تتبع جدول hala_faq: أي تعديل يُعاد تضمينه خلال تِك واحد.
  let faqSync = { changed: false };
  try {
    faqSync = await syncHalaFaqEmbeddings(env);
  } catch (err) {
    logError(context, { requestId, path: "cron/healthcheck", code: "FAQ_EMBED_SYNC_FAILED", internal: String(err?.message || err).slice(0, 250) });
  }

  // ٣.٣ — تقليم دوري لسجلات error_log/webhook_log (٩٠ يوماً) وig_processed_events
  // (٤٨ ساعة)؛ التفاصيل والدفعات المحدودة بـ`domain/retention.js`.
  const retention = await pruneOldLogs(env, context);

  await recordHeartbeat(env, { job: "healthcheck", ok: healthy, note: healthy ? null : critical.map(([k]) => k).join(",") });
  return { ok: true, healthy, checks, waTokenCheck, sallaTokenExpiring: sallaExpiry.expiring.length, igTokens, faqSync, retention };
}

export const onRequestGet = withApi.raw(healthcheckHandler, {
  csrf: false,
  cron: true,
  cronMessage: "فحص الصحة الدوري غير مفعّل حالياً على الخادم.",
  logPath: "cron/healthcheck"
});

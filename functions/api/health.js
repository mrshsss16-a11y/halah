// GET /api/health — فحص حالة علني بلا مصادقة.
//
// المرحلة ٤: تنسيق فقط — الفحوص بـ`domain/health.js`، وهنا ترجمة النتيجة
// لرمز HTTP فقط. نفس الجسم ونفس الرموز حرفياً.
import { generateRequestId } from "../_lib/core/respond.js";
import { logError } from "../_lib/core/errorLog.js";
import { readHeartbeats } from "../_lib/core/heartbeat.js";
import { publicHealthChecks } from "../_lib/domain/health.js";

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-cache, no-store, must-revalidate"
};

export async function onRequest(context) {
  const requestId = generateRequestId();
  try {
    const start = Date.now();
    const { checks, criticalDown } = await publicHealthChecks(context?.env, readHeartbeats);

    // O1: أي فحص حرج (db/ai_primary/cache) بحالة error أو missing ⇒ 503،
    // بنفس الجسم — لا تفاصيل داخلية إضافية، فقط رمز الحالة يتغيّر.
    return new Response(
      JSON.stringify({
        status: criticalDown ? "degraded" : "ok",
        timestamp: new Date().toISOString(),
        checks,
        latencyMs: Date.now() - start
      }, null, 2),
      { status: criticalDown ? 503 : 200, headers: HEADERS }
    );
  } catch (err) {
    // مسار علني بلا مصادقة: نص الخطأ الخام قد يسمّي bindings أو أسراراً أو
    // مضيفات داخلية. النص للعميل ثابت وعربي، والتفصيل للسجل تحت requestId.
    logError(context, { requestId, path: "health", code: "HEALTH_CHECK_FAILED", internal: String((err && err.stack) || err) });
    return new Response(
      JSON.stringify({
        status: "ok",
        timestamp: new Date().toISOString(),
        error: "تعذّر إكمال فحص الحالة. حاول مرة ثانية بعد شوي.",
        code: "HEALTH_CHECK_FAILED",
        requestId
      }, null, 2),
      { status: 200, headers: HEADERS }
    );
  }
}

export const onRequestGet = onRequest;

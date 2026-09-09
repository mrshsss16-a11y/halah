import { generateRequestId } from "../_lib/core/respond.js";
import { logError } from "../_lib/core/errorLog.js";
import { readHeartbeats } from "../_lib/core/heartbeat.js";

// O2: أي وظيفة cron نبضها الأخير أقدم من هذا = "error" (توقف cron-worker).
const CRON_HEARTBEAT_STALE_MS = 25 * 60 * 1000;
// O1: هذه الفحوص وحدها تُسقط HTTP إلى 503 عند error/missing — بقية الفحوص
// (مثل مزوّدي الاحتياط الاختياريين) معلوماتية فقط، غيابها ليس عطلاً.
const CRITICAL_CHECK_KEYS = ["db", "ai_primary", "cache"];

export async function onRequest(context) {
  const requestId = generateRequestId();
  try {
    const { env } = context || {};
    const start = Date.now();
    const checks = {
      db: 'unknown',
      cache: 'unknown',
      vectorize: 'unknown',
      cron: 'unknown',
      ai_primary: 'unknown',
      groq_fallback: 'unknown',
      openrouter_fallback: 'unknown'
    };

    // Check DB
    try {
      if (env && env.DB) {
        await env.DB.prepare('SELECT 1').first();
        checks.db = 'ok';
      } else {
        checks.db = 'missing';
      }
    } catch {
      checks.db = 'error';
    }

    // Check KV Cache
    try {
      if (env && env.HALA_CACHE) {
        await env.HALA_CACHE.get('ping');
        checks.cache = 'ok';
      } else {
        checks.cache = 'missing';
      }
    } catch {
      checks.cache = 'error';
    }

    // Check Vectorize
    try {
      if (env && env.VECTORIZE_INDEX) {
        checks.vectorize = 'ok';
      } else {
        checks.vectorize = 'missing';
      }
    } catch {
      checks.vectorize = 'error';
    }

    // Check Workers AI Primary
    try {
      if (env && env.AI) {
        checks.ai_primary = 'ok';
      } else {
        checks.ai_primary = 'missing';
      }
    } catch {
      checks.ai_primary = 'error';
    }

    // Check Groq Fallback Secret
    checks.groq_fallback = (env && env.GROQ_API_KEY) ? 'ok' : 'missing';

    // Check OpenRouter Fallback Secret
    checks.openrouter_fallback = (env && env.OPENROUTER_API_KEY) ? 'ok' : 'missing';

    // O2: نبض الـcron — الجدول قد لا يكون مطبَّقاً بعد على البعيد، فذلك
    // "missing" لا "error" (لا نُسقط health لأجل هجرة لم تُطبَّق بعد).
    try {
      const heartbeats = await readHeartbeats(env);
      if (heartbeats === null) {
        checks.cron = 'missing';
      } else if (heartbeats.length === 0) {
        checks.cron = 'missing';
      } else {
        const now = Date.now();
        const stale = heartbeats.filter((h) => {
          if (!h.last_run_at) return true;
          const ts = Date.parse(`${h.last_run_at}Z`);
          return !Number.isFinite(ts) || (now - ts) > CRON_HEARTBEAT_STALE_MS;
        });
        const failed = heartbeats.filter((h) => h.last_ok === 0);
        checks.cron = (stale.length > 0 || failed.length > 0) ? 'error' : 'ok';
      }
    } catch {
      checks.cron = 'error';
    }

    const latencyMs = Date.now() - start;

    // O1: أي فحص حرج (db/ai_primary/cache) بحالة error أو missing ⇒ 503،
    // بنفس الجسم — لا تفاصيل داخلية إضافية، فقط رمز الحالة يتغيّر.
    const criticalDown = CRITICAL_CHECK_KEYS.some((k) => checks[k] === 'error' || checks[k] === 'missing');
    const httpStatus = criticalDown ? 503 : 200;

    return new Response(JSON.stringify({
      status: criticalDown ? "degraded" : "ok",
      timestamp: new Date().toISOString(),
      checks,
      latencyMs
    }, null, 2), {
      status: httpStatus,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  } catch (err) {
    // Public unauthenticated path: the raw error message can name bindings,
    // secrets or internal hosts. Merchant-facing text stays fixed and Arabic;
    // the detail goes to the error log, keyed by requestId.
    logError(context, {
      requestId,
      path: "health",
      code: "HEALTH_CHECK_FAILED",
      internal: String((err && err.stack) || err)
    });
    return new Response(JSON.stringify({
      status: "ok",
      timestamp: new Date().toISOString(),
      error: "تعذّر إكمال فحص الحالة. حاول مرة ثانية بعد شوي.",
      code: "HEALTH_CHECK_FAILED",
      requestId
    }, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }
}

export const onRequestGet = onRequest;

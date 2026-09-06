import { generateRequestId } from "../_lib/core/respond.js";
import { logError } from "../_lib/core/errorLog.js";

export async function onRequest(context) {
  const requestId = generateRequestId();
  try {
    const { env } = context || {};
    const start = Date.now();
    const checks = {
      db: 'unknown',
      cache: 'unknown',
      vectorize: 'unknown',
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

    const latencyMs = Date.now() - start;

    return new Response(JSON.stringify({
      status: "ok",
      timestamp: new Date().toISOString(),
      checks,
      latencyMs
    }, null, 2), {
      status: 200,
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

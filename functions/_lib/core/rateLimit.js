import { logError } from "./errorLog.js";
// Cloudflare sets cf-connecting-ip on every real request and it cannot be
// spoofed by the client. Do NOT fall back to x-forwarded-for — that IS client
// controlled, so an attacker would just rotate it to get a fresh limiter bucket
// per request (SECURITY_AUDIT L2). A missing header (only in local/test) falls
// back to a single shared key, which fails safe (over-throttles) not open.
export function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

// N3 — الافتراضي fail-open (قرار مدير P28: عطل KV ما يوقف كل التجار).
// الاستثناء: مسارات المصادقة تُمرَّر `{ failClosed: true }` — هناك fail-open
// يعني نافذة تخمين كلمات مرور/رموز OTP بلا حد، وهذا أخطر من رفض مؤقت.
export async function checkRateLimit(env, clientIp, actionKey = "global", limit = 30, windowSeconds = 60, { failClosed = false } = {}) {
  const denied = { allowed: false, remaining: 0, resetInSeconds: windowSeconds, degraded: true };

  if (!env?.HALA_CACHE) {
    if (failClosed) {
      logError({ env }, { requestId: null, path: "core/rateLimit", code: "RATE_LIMIT_KV_MISSING", internal: `${actionKey}: no KV binding — failing closed` });
      return denied;
    }
    return { allowed: true, remaining: limit, resetInSeconds: 0 };
  }

  const key = `rl:${clientIp}:${actionKey}`;
  const now = Math.floor(Date.now() / 1000);

  try {
    const recordStr = await env.HALA_CACHE.get(key);
    let record = recordStr ? JSON.parse(recordStr) : null;

    if (record) {
      if (now > record.resetAt) {
        // window expired, reset
        record = { count: 1, resetAt: now + windowSeconds };
      } else {
        record.count++;
      }
    } else {
      record = { count: 1, resetAt: now + windowSeconds };
    }

    if (record.count > limit) {
      return { 
        allowed: false, 
        remaining: 0, 
        resetInSeconds: record.resetAt - now > 0 ? record.resetAt - now : 0
      };
    }

    const ttl = record.resetAt - now > 0 ? record.resetAt - now : windowSeconds;
    await env.HALA_CACHE.put(key, JSON.stringify(record), { expirationTtl: ttl });

    return { 
      allowed: true, 
      remaining: limit - record.count, 
      resetInSeconds: ttl
    };
  } catch (error) {
    logError({ env }, { requestId: null, path: "core/rateLimit", code: "RATE_LIMIT_CHECK_FAILED", internal: `${actionKey}: ${error?.message || error} — ${failClosed ? "failing closed" : "failing open"}` });
    if (failClosed) return denied;
    return { allowed: true, remaining: limit, resetInSeconds: 0 };
  }
}

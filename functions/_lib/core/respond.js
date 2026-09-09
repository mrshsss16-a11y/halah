// Uniform JSON responses for functions/api/*.js — Pages Functions use the
// Request/Response Web API (not Node req/res), so this is the Workers
// equivalent of the old Vercel withApi() wrapper.
import { getSecurityHeaders } from "./security.js";
import { logError } from "./errorLog.js";
import { classifyError, messageFor, statusFor, DomainError } from "./errors.js";
import { resolveAllowedOrigin, corsHeaders, widgetAllowlist } from "./cors.js";
import { assertTrustedWrite } from "./csrf.js";

// Short, URL-safe, no external dep — collision odds irrelevant here (it's a
// correlation id for logs/support, not a security token).
// Exported so raw (non-withApi) handlers — e.g. webhook.js, which needs the
// raw request body for signature verification — can log with the same id
// shape instead of duplicating this.
export function generateRequestId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...getSecurityHeaders(), ...extraHeaders }
  });
}

/**
 * Throwable from any handler to produce a proper HTTP status + safe message
 * instead of the generic 502. Used by the tenant-isolation checks in
 * session.js (401 LOGIN_REQUIRED) and admin gates (403).
 *
 * `message` is what ships to the client (must be Arabic, safe to show).
 * `internal` is optional extra detail for the error log only — never sent
 * to the client. Never put PII (phone, email, message text) in either.
 */
export class ApiError extends Error {
  constructor(status, message, code = "ERROR", internal = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.internal = internal;
  }
}

/**
 * Swiss-watch HTTP API wrapper supporting both POST (JSON body) and GET (query params).
 *
 * Every response carries X-Request-Id. On error it's echoed in the JSON body
 * too, so a merchant reporting "صار خطأ" can hand over one short id instead
 * of a screenshot — and /api/admin/errors can look it up directly.
 *
 * `{ cors: true }` adds Access-Control-Allow-Origin (from cors.js's
 * allowlist) to EVERY response path — success, ApiError, and unhandled —
 * so a cross-origin caller can read the response body at all, not just the
 * happy path. Only opt in for endpoints meant to be called from another
 * origin (currently just /api/support, the embeddable widget backend); the
 * file exporting `onRequestPost` must also export `onRequestOptions` from
 * cors.js's `corsPreflight` for the browser's preflight request.
 */
export function withApi(handler, { cors = false } = {}) {
  return async function onRequest(context) {
    const { request, env } = context;
    const requestId = generateRequestId();
    const extraHeaders = cors ? corsHeaders(resolveAllowedOrigin(request, env)) : {};
    let body = {};
    const path = new URL(request.url).pathname;

    // P42 — before touching the body: Origin allowlist + JSON-only writes. One
    // point for every withApi endpoint; raw handlers call assertTrustedWrite
    // themselves; webhooks are signature-guarded and never pass through here.
    try {
      assertTrustedWrite(request, env, { allowedOrigins: cors ? widgetAllowlist(env) : [] });
    } catch (err) {
      if (err instanceof ApiError) {
        logError(context, { requestId, path, code: err.code, internal: err.internal || err.message });
        return json({ ok: false, error: err.message, code: err.code, requestId }, err.status, { "X-Request-Id": requestId, ...extraHeaders });
      }
      throw err;
    }

    if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
      try {
        body = await request.json();
      } catch {
        body = {}; // Allow empty JSON body gracefully
      }
    } else if (request.method === "GET" || request.method === "HEAD") {
      try {
        const url = new URL(request.url);
        body = Object.fromEntries(url.searchParams.entries());
      } catch {
        body = {};
      }
    }

    try {
      const result = await handler(body, env, request, requestId, context);
      if (result instanceof Response) {
        result.headers.set("X-Request-Id", requestId);
        for (const [k, v] of Object.entries(extraHeaders)) result.headers.set(k, v);
        return result;
      }
      return json(result, 200, { "X-Request-Id": requestId, ...extraHeaders });
    } catch (err) {
      // DomainError يُترجَم بنفس مسار ApiError حرفياً — نفس الحالة، نفس الجسم
      // `{ ok, error, code, requestId }`. المجال لا يعرف HTTP، والترجمة هنا.
      if (err instanceof ApiError || err instanceof DomainError) {
        if (err.status >= 500) {
          logError(context, { requestId, path, code: err.code, internal: err.internal || err.message });
        }
        return json(
          { ok: false, error: err.message, code: err.code, requestId },
          err.status,
          { "X-Request-Id": requestId, ...extraHeaders }
        );
      }
      // D4: خطأ غير مُصنَّف يُترجَم لأقرب كود معروف بدل رسالة عامة واحدة
      // للجميع. الفرق عملي: "الخدمة مزحومة، جرّب بعد دقيقة" تُنهي الموقف،
      // بينما "صار خلل مؤقت" تُنتج اتصالاً بالدعم. الكود الأصلي كامل يبقى
      // بالسجل تحت requestId — التاجر يعطينا الرقم ونشوف التفصيل.
      const code = classifyError(err);
      logError(context, {
        requestId,
        path,
        code: `UNHANDLED:${code}`,
        internal: String((err && err.stack) || err)
      });
      return json(
        { ok: false, error: messageFor(code), code, requestId },
        statusFor(code),
        { "X-Request-Id": requestId, ...extraHeaders }
      );
    }
  };
}

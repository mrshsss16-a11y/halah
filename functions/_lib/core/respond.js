// Uniform JSON responses for functions/api/*.js — Pages Functions use the
// Request/Response Web API (not Node req/res), so this is the Workers
// equivalent of the old Vercel withApi() wrapper.
import { getSecurityHeaders } from "./security.js";
import { logError } from "./errorLog.js";

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
 */
export function withApi(handler) {
  return async function onRequest(context) {
    const { request, env } = context;
    const requestId = generateRequestId();
    let body = {};

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

    const path = new URL(request.url).pathname;

    try {
      const result = await handler(body, env, request, requestId);
      if (result instanceof Response) {
        result.headers.set("X-Request-Id", requestId);
        return result;
      }
      return json(result, 200, { "X-Request-Id": requestId });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status >= 500) {
          logError(context, { requestId, path, code: err.code, internal: err.internal || err.message });
        }
        return json(
          { ok: false, error: err.message, code: err.code, requestId },
          err.status,
          { "X-Request-Id": requestId }
        );
      }
      logError(context, { requestId, path, code: "UNHANDLED", internal: String((err && err.stack) || err) });
      return json(
        {
          ok: false,
          error: "صار خلل مؤقت أثناء المعالجة. حاول مرة ثانية بعد شوي.",
          code: "PROVIDER_ERROR",
          requestId
        },
        502,
        { "X-Request-Id": requestId }
      );
    }
  };
}

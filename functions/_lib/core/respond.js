// Uniform JSON responses for functions/api/*.js — Pages Functions use the
// Request/Response Web API (not Node req/res), so this is the Workers
// equivalent of the old Vercel withApi() wrapper.
import { getSecurityHeaders } from "./security.js";

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
 */
export class ApiError extends Error {
  constructor(status, message, code = "ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Swiss-watch HTTP API wrapper supporting both POST (JSON body) and GET (query params).
 */
export function withApi(handler) {
  return async function onRequest(context) {
    const { request } = context;
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

    try {
      const result = await handler(body, context.env, context.request);
      if (result instanceof Response) return result;
      return json(result);
    } catch (err) {
      if (err instanceof ApiError) {
        return json({ ok: false, error: err.message, code: err.code }, err.status);
      }
      console.error("[hala-api-error]", err);
      const debug = context.env.HALA_DEBUG_AI === "1";
      return json(
        {
          ok: false,
          error: "صار خلل مؤقت أثناء المعالجة. حاول مرة ثانية بعد شوي.",
          code: "PROVIDER_ERROR",
          detail: debug ? String((err && err.message) || err) : undefined
        },
        502
      );
    }
  };
}

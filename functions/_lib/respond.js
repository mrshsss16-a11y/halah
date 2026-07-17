// Uniform JSON responses for functions/api/*.js — Pages Functions use the
// Request/Response Web API (not Node req/res), so this is the Workers
// equivalent of the old Vercel withApi() wrapper.
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders }
  });
}

export function withApi(handler) {
  return async function onRequestPost(context) {
    let body;
    try {
      body = await context.request.json();
    } catch {
      return json({ error: "طلب غير صالح (JSON مفقود أو تالف)." }, 400);
    }
    try {
      const result = await handler(body, context.env, context.request);
      return json(result);
    } catch (err) {
      console.error("[hala-api-error]", err);
      const debug = context.env.HALA_DEBUG_AI === "1";
      return json(
        {
          error: "صار خلل مؤقت أثناء توليد الرد بالذكاء الاصطناعي. حاول مرة ثانية بعد شوي.",
          code: "PROVIDER_ERROR",
          detail: debug ? String((err && err.message) || err) : undefined
        },
        502
      );
    }
  };
}

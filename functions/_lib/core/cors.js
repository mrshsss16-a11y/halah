// CORS for the ONE public, cross-origin-embeddable endpoint (the website
// widget, /api/support). Every other endpoint stays same-origin only — do
// not import this into anything that isn't meant to be called from a
// third-party page.
//
// Fail-closed allowlist, not "*": the widget's storeId is currently
// unmetered ("hala") and even a metered storeId still burns real AI-gateway
// cost per request, so an open origin would let any site on the internet
// embed the widget and run up Aura's bill / rate-limit budget for free.
//
// Scope note (deliberate, not a TODO left dangling): the allowlist is one
// env var today because there is exactly one real site (aura.sa). The day a
// second merchant embeds the widget on their own domain, this becomes a
// per-store domain lookup (a column, not a redesign) — not built now because
// there is no second site to design it against yet.
function allowlist(env) {
  return (env.WIDGET_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The raw allowlist — shared with csrf.js so a widget origin passes the CSRF gate too. */
export function widgetAllowlist(env) {
  return allowlist(env);
}

/** Returns the Origin header value if (and only if) it's allowlisted, else null. */
export function resolveAllowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return null; // same-origin call (no Origin header) — nothing to add
  return allowlist(env).includes(origin) ? origin : null;
}

/** Header set to merge into a response when origin is allowed; {} otherwise (browser then blocks it — safe default). */
export function corsHeaders(allowedOrigin) {
  if (!allowedOrigin) return {};
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin"
  };
}

/** Preflight handler — export as `onRequestOptions` from any file using this module. */
export function corsPreflight(env, request) {
  const allowed = resolveAllowedOrigin(request, env);
  return new Response(null, { status: allowed ? 204 : 403, headers: corsHeaders(allowed) });
}

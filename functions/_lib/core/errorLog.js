// Structured error logging — replaces raw `console.error(err)` (which spills
// stack traces that may embed request bodies — phone numbers, chat text —
// into Cloudflare's log stream).
//
// Every call site must pass storeId explicitly when known, and must never
// pass raw user text (messages, phone numbers, emails) in `internal` — only
// the error class/message and static context (endpoint, code). This file has
// no way to enforce that at the call site, so it's the one rule every future
// handler touching this module must follow (see docs/PARALLEL_TRACKS.md §أ.٤).
//
// Dual sink: console (always — visible via `wrangler tail` / the Observability
// tab now that wrangler.toml enables it) + D1 (queryable by /api/admin/errors).
// The D1 write is fire-and-forget: a logging failure must never break the
// response the caller is already returning to the merchant.
export function logError(context, { requestId, path, code, internal, storeId = null }) {
  const truncatedInternal = internal ? String(internal).slice(0, 2000) : null;
  const entry = { requestId, path, code, storeId, internal: truncatedInternal, ts: new Date().toISOString() };
  console.error("[hala-error]", JSON.stringify(entry));

  const db = context?.env?.DB;
  if (!db) return;

  const write = db
    .prepare(
      `INSERT INTO error_log (request_id, store_id, code, path, internal) VALUES (?, ?, ?, ?, ?)`
    )
    .bind(requestId, storeId, code, path, truncatedInternal)
    .run()
    .catch((e) => console.error("[hala-error-log-write-failed]", e?.message));

  if (context?.waitUntil) {
    context.waitUntil(write);
  }
}

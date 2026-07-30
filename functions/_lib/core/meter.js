// Daily free-tier usage metering with KV-first fast path.
//
// Hot path (KV cache hit):
//   READ  KV  quota key → if under limit → WRITE KV increment → return ok
//   The D1 write happens async in the background (context.waitUntil or fire-and-forget).
//   This cuts meter latency from ~60ms (2× D1 round-trips) to ~5ms (1× KV read).
//
// Cold path (first request of the day, or KV miss):
//   Falls back to atomic D1 INSERT..ON CONFLICT upsert (unchanged behaviour).
//   D1 row is still the source of truth — KV is a performance overlay only.
//
// KV key format: meter:{merchantId}:{YYYY-MM-DD}
// KV TTL:        25h (auto-expires slightly after UTC midnight rollover)
export const DAILY_LIMIT = 50;
export const MONTHLY_FREE_LIMIT = 1000; // 1,000 Free Meta WhatsApp Service Conversations per Month
export const COSTS = { copy: 1, chat: 1, image: 3, ocr: 1, voice: 2, campaign: 1, recovery: 1 };

const METER_TTL_SECONDS = 25 * 60 * 60; // 25h — expires after UTC day rolls over

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
}

function kvKey(merchantId) {
  return `meter:${merchantId}:${today()}`;
}

/**
 * KV-accelerated atomic meter check.
 * Returns immediately from KV cache when possible (~5ms vs ~60ms D1).
 *
 * @returns {Promise<{ok: boolean, remaining: number, used: number, limit: number}>}
 */
export async function checkAndConsume(env, merchantId, cost) {
  if (!env.DB) return { ok: true, remaining: DAILY_LIMIT, used: 0, limit: DAILY_LIMIT };

  const key = kvKey(merchantId);

  // ── Fast path: KV cache ─────────────────────────────────────────────────
  if (env.HALA_CACHE) {
    try {
      const cached = await env.HALA_CACHE.get(key);
      const used = cached ? parseInt(cached, 10) : 0;

      if (used + cost > DAILY_LIMIT) {
        return { ok: false, remaining: 0, used, limit: DAILY_LIMIT };
      }

      const newUsed = used + cost;
      // Write-back to KV (non-blocking — latency path ends here)
      env.HALA_CACHE.put(key, String(newUsed), { expirationTtl: METER_TTL_SECONDS }).catch(() => {});

      // Sync to D1 in the background — doesn't block the response
      syncToD1(env, merchantId, cost).catch(() => {});

      return {
        ok: true,
        remaining: Math.max(0, DAILY_LIMIT - newUsed),
        used: newUsed,
        limit: DAILY_LIMIT
      };
    } catch {
      // KV unavailable — fall through to D1
    }
  }

  // ── Cold path: D1 (source of truth) ────────────────────────────────────
  const day = today();
  const result = await env.DB.prepare(
    `INSERT INTO usage_meter (merchant_id, day, credits_used, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (merchant_id, day) DO UPDATE SET
       credits_used = credits_used + ?,
       updated_at = datetime('now')
     WHERE credits_used + ? <= ?`
  )
    .bind(merchantId, day, cost, cost, cost, DAILY_LIMIT)
    .run();

  const row = await env.DB.prepare(
    "SELECT credits_used FROM usage_meter WHERE merchant_id = ? AND day = ?"
  )
    .bind(merchantId, day)
    .first();
  const used = (row && row.credits_used) || 0;

  // Warm the KV cache for next requests
  if (env.HALA_CACHE && result.meta.changes > 0) {
    env.HALA_CACHE.put(key, String(used), { expirationTtl: METER_TTL_SECONDS }).catch(() => {});
  }

  return {
    ok: result.meta.changes > 0,
    remaining: Math.max(0, DAILY_LIMIT - used),
    used,
    limit: DAILY_LIMIT
  };
}

/** Background D1 sync — called from KV fast path, never blocks the response. */
async function syncToD1(env, merchantId, cost) {
  const day = today();
  await env.DB.prepare(
    `INSERT INTO usage_meter (merchant_id, day, credits_used, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (merchant_id, day) DO UPDATE SET
       credits_used = credits_used + ?,
       updated_at = datetime('now')`
  )
    .bind(merchantId, day, cost, cost)
    .run();
}

export async function getUsage(env, merchantId) {
  // Try KV first for instant reads
  if (env.HALA_CACHE) {
    try {
      const cached = await env.HALA_CACHE.get(kvKey(merchantId));
      if (cached !== null) {
        const used = parseInt(cached, 10);
        return { used, remaining: Math.max(0, DAILY_LIMIT - used), limit: DAILY_LIMIT, monthlyFreeLimit: MONTHLY_FREE_LIMIT, monthlyFreeInfo: "1,000 محادثة / رسالة مجانية شهرياً من Meta" };
      }
    } catch { /* fall through */ }
  }

  const day = today();
  const row = env.DB
    ? await env.DB.prepare(
        "SELECT credits_used FROM usage_meter WHERE merchant_id = ? AND day = ?"
      )
        .bind(merchantId, day)
        .first()
    : null;
  const used = (row && row.credits_used) || 0;
  return { used, remaining: Math.max(0, DAILY_LIMIT - used), limit: DAILY_LIMIT, monthlyFreeLimit: MONTHLY_FREE_LIMIT, monthlyFreeInfo: "1,000 محادثة / رسالة مجانية شهرياً من Meta" };
}

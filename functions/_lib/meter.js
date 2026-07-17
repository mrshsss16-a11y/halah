// Daily free-tier usage metering. One row per (merchant, UTC day); the check
// and the increment happen in a single SQL statement so concurrent requests
// can't both slip past the limit (INSERT..ON CONFLICT..DO UPDATE..WHERE only
// applies the update when the WHERE condition holds — if it doesn't, the
// statement is a no-op and reports zero rows changed, which is our atomic
// "reject" signal).
export const DAILY_LIMIT = 50;
export const COSTS = { copy: 1, chat: 1, image: 3 };

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/**
 * @returns {Promise<{ok: boolean, remaining: number, used: number, limit: number}>}
 */
export async function checkAndConsume(env, merchantId, cost) {
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

  return {
    ok: result.meta.changes > 0,
    remaining: Math.max(0, DAILY_LIMIT - used),
    used,
    limit: DAILY_LIMIT
  };
}

export async function getUsage(env, merchantId) {
  const day = today();
  const row = await env.DB.prepare(
    "SELECT credits_used FROM usage_meter WHERE merchant_id = ? AND day = ?"
  )
    .bind(merchantId, day)
    .first();
  const used = (row && row.credits_used) || 0;
  return { used, remaining: Math.max(0, DAILY_LIMIT - used), limit: DAILY_LIMIT };
}

// POST /api/stats — real, honest numbers only (no fabricated social proof —
// same rule enforced on the marketer persona itself in functions/_lib/persona.js).
import { json } from "../_lib/core/respond.js";

// A missing table or a renamed column must not take the whole endpoint down —
// this feeds public-facing counters, so degrade to 0 rather than 500.
async function scalar(env, sql, key, fallback = 0) {
  if (!env?.DB) return fallback;
  const row = await env.DB.prepare(sql)
    .first()
    .catch((err) => {
      console.error("[stats]", key, err);
      return null;
    });
  return row?.[key] ?? fallback;
}

export async function onRequestPost(context) {
  const env = context?.env;

  // NOTE: abandoned_carts stores the cart value in `total` (see
  // migrations/0002_copy_and_whatsapp.sql) — not `amount`.
  const [recoveredSalesSAR, consultationTickets, cacheSavingRate] = await Promise.all([
    scalar(env, "SELECT SUM(total) AS v FROM abandoned_carts WHERE status = 'recovered'", "v"),
    scalar(env, "SELECT COUNT(*) AS v FROM consultation_bookings", "v"),
    scalar(
      env,
      "SELECT (CAST(SUM(CASE WHEN response_time_ms < 5 THEN 1 ELSE 0 END) AS REAL) / COUNT(*)) * 100 AS v FROM hala_cache",
      "v"
    )
  ]);

  return json({
    recoveredSalesSAR,
    consultationTickets,
    halaCacheSavingRate: cacheSavingRate
  });
}

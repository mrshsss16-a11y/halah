// POST /api/stats — real, honest numbers only (no fabricated social proof —
// same rule enforced on the marketer persona itself in functions/_lib/persona.js).
import { json } from "../_lib/core/respond.js";

export async function onRequestPost(context) {
  const env = context?.env;
  
  const recoveredQuery = await env?.DB?.prepare("SELECT SUM(amount) AS total FROM abandoned_carts WHERE status = 'recovered'")?.first();
  const recoveredSalesSAR = recoveredQuery?.total ?? 0;

  const ticketsQuery = await env?.DB?.prepare("SELECT COUNT(*) AS c FROM consultation_bookings")?.first();
  const consultationTickets = ticketsQuery?.c ?? 0;

  // نسبة توفير الكاش السريع (< 5ms)
  const cacheQuery = await env?.DB?.prepare("SELECT (CAST(SUM(CASE WHEN response_time_ms < 5 THEN 1 ELSE 0 END) AS REAL) / COUNT(*)) * 100 AS rate FROM hala_cache")?.first();
  const cacheSavingRate = cacheQuery?.rate ?? 0;

  return json({
    recoveredSalesSAR,
    consultationTickets,
    halaCacheSavingRate: cacheSavingRate
  });
}

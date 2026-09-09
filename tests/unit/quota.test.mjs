import { createRunner } from "../_helpers.mjs";
import { fakeKv } from "../_helpers.mjs";

const { assert, done } = createRunner("quota");

async function main() {
  // 13. Monthly quota — exhaustion + per-merchant isolation
  const { checkAndConsumeMonthly, MONTHLY_BUCKET_LIMITS } = await import("../../functions/_lib/core/meter.js");

  // D1 stand-in that honours the conditional upsert's WHERE used + cost <= limit,
  // so the cold path is tested against real bookkeeping, not a stub that says yes.
  function fakeQuotaDb() {
    const rows = new Map(); // "merchant|period|bucket" → used
    return {
      rows,
      prepare(sql) {
        return {
          bind(...args) {
            return {
              run: async () => {
                const [merchantId, period, bucket, cost, , , limit] = args;
                const k = `${merchantId}|${period}|${bucket}`;
                const used = rows.get(k) || 0;
                if (used + cost > limit) return { meta: { changes: 0 } };
                rows.set(k, used + cost);
                return { meta: { changes: 1 } };
              },
              first: async () => {
                const [merchantId, period, bucket] = args;
                if (!/merchant_id/.test(sql)) throw new Error("quota query is not merchant-scoped");
                const k = `${merchantId}|${period}|${bucket}`;
                return rows.has(k) ? { used: rows.get(k) } : null;
              }
            };
          }
        };
      }
    };
  }

  const imgLimit = MONTHLY_BUCKET_LIMITS.image;

  // ── Cold path (D1 only, no KV) ─────────────────────────────────────────
  const coldEnv = { DB: fakeQuotaDb() };
  let lastCold = null;
  for (let i = 0; i < imgLimit; i++) {
    lastCold = await checkAndConsumeMonthly(coldEnv, "m_aaa", "image");
    if (!lastCold.ok) break;
  }
  assert(lastCold.ok && lastCold.used === imgLimit, `D1 path: merchant A consumed its whole ${imgLimit}-image quota`);
  const coldOver = await checkAndConsumeMonthly(coldEnv, "m_aaa", "image");
  assert(!coldOver.ok, "D1 path: the request past the monthly limit is refused");
  assert(coldOver.remaining === 0, "D1 path: an exhausted quota reports 0 remaining");

  // Merchant B is untouched by merchant A having burned its entire quota
  const coldB = await checkAndConsumeMonthly(coldEnv, "m_bbb", "image");
  assert(
    coldB.ok && coldB.used === 1 && coldB.remaining === imgLimit - 1,
    "tenant isolation: merchant A exhausting its quota does not consume merchant B's"
  );
  // …and buckets don't bleed into each other for the same merchant
  const coldOtherBucket = await checkAndConsumeMonthly(coldEnv, "m_aaa", "message");
  assert(coldOtherBucket.ok && coldOtherBucket.used === 1, "an exhausted image bucket does not exhaust the message bucket");

  // ── Fast path (KV cache in front of D1) ────────────────────────────────
  const quotaKv = fakeKv();
  const hotEnv = { DB: fakeQuotaDb(), HALA_CACHE: quotaKv };
  let lastHot = null;
  for (let i = 0; i < imgLimit; i++) {
    lastHot = await checkAndConsumeMonthly(hotEnv, "m_aaa", "image");
    if (!lastHot.ok) break;
  }
  assert(lastHot.ok && lastHot.used === imgLimit, "KV path: merchant A consumed its whole image quota");
  assert(!(await checkAndConsumeMonthly(hotEnv, "m_aaa", "image")).ok, "KV path: the request past the monthly limit is refused");
  const hotB = await checkAndConsumeMonthly(hotEnv, "m_bbb", "image");
  assert(hotB.ok && hotB.used === 1, "KV path tenant isolation: merchant B's quota is keyed separately");
  // A cost larger than what is left must be refused whole, not partially charged
  const hotC = await checkAndConsumeMonthly(hotEnv, "m_ccc", "image", imgLimit + 1);
  assert(!hotC.ok && hotC.used === 0, "an over-budget single call is refused without consuming anything");

  // Unknown bucket must throw rather than silently granting an unmetered call
  let unknownBucketThrew = false;
  try {
    await checkAndConsumeMonthly(hotEnv, "m_aaa", "not_a_bucket");
  } catch {
    unknownBucketThrew = true;
  }
  assert(unknownBucketThrew, "checkAndConsumeMonthly throws on an unknown bucket instead of allowing the call");
}

main()
  .then(() => done())
  .catch((e) => {
    console.error("❌ Tests threw an exception:");
    console.error(e);
    process.exit(1);
  });

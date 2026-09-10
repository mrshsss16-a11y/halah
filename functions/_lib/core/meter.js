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
const DAILY_LIMIT = 50;
const MONTHLY_FREE_LIMIT = 1000; // Meta's WhatsApp service-conversation free tier is uncapped since 2026-11-01 — this constant is unused, kept only as a documented historical note (see docs/ROADMAP.md m2.2.5).
// ── Monthly merchant quota (docs/ROADMAP.md m2.2.5) ─────────────────────────
// Two independent buckets instead of one blended daily credit pool — the old
// DAILY_LIMIT let a single merchant exhaust the entire account's shared free
// AI capacity in one day (see migrations/0011_monthly_quota.sql for the math).
// "hala" is Aura's own operational line, not a trial merchant — exempt from
// both buckets, same as the image-generation admin beta is exempt by gate.
export const MONTHLY_BUCKET_LIMITS = { description: 60, message: 300, image: 20 };
const UNMETERED_MERCHANT_IDS = new Set(["hala"]);

/**
 * معفى من الحصة الشهرية؟ `hala` ثابت بالكود (خط أورا التشغيلي). وفوقه قائمة
 * مؤقتة بمتغيّر البيئة `UNMETERED_MERCHANT_IDS` (معرّفات مفصولة بفواصل) —
 * أُضيفت 2026-09-10 لمتجر مراجعة سلة: مراجع يجرّب التوليد بالجملة على عشرين
 * منتجاً ويكرّر يصطدم بسقف ٦٠ وسط التقييم. بمتغيّر لا بالكود: يُزال بسطر بعد
 * القبول بلا نشر، ولا يبقى معرّف تاجر إنتاجي محفوراً بالمصدر.
 *
 * الإعفاء للحصة الشهرية **وحدها**: حدود المعدل (checkRateLimit) وحدّ سلة
 * (طلب/ثانية) لا تمرّ من هنا وتبقى سارية. المطابقة تامة بعد التشذيب — لا
 * `includes` على النص كي لا يُعفى `m_ab` لأن `m_abc` مُدرج.
 */
function isUnmetered(env, merchantId) {
  if (!merchantId) return false;
  if (UNMETERED_MERCHANT_IDS.has(merchantId)) return true;
  const extra = String(env?.UNMETERED_MERCHANT_IDS || "");
  if (!extra) return false;
  return extra.split(",").map((s) => s.trim()).filter(Boolean).includes(merchantId);
}

const METER_TTL_SECONDS = 25 * 60 * 60; // 25h — expires after UTC day rolls over
const MONTHLY_TTL_SECONDS = 32 * 24 * 60 * 60; // 32d — always outlives the calendar month it caches

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
}

function currentMonth() {
  return today().slice(0, 7); // "YYYY-MM" from the same Riyadh-local date source
}

function kvKey(merchantId) {
  return `meter:${merchantId}:${today()}`;
}

function monthlyKvKey(merchantId, bucket) {
  return `quota:${merchantId}:${bucket}:${currentMonth()}`;
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

/**
 * Monthly quota check + consume for one bucket ("description" | "message").
 * Same KV-first / D1-source-of-truth shape as checkAndConsume above, just
 * keyed by calendar month instead of day, and by bucket instead of a single
 * blended credit pool. "hala" (Aura's own line) is always unmetered.
 *
 * @returns {Promise<{ok: boolean, remaining: number, used: number, limit: number, bucket: string}>}
 */
export async function checkAndConsumeMonthly(env, merchantId, bucket, cost = 1) {
  const limit = MONTHLY_BUCKET_LIMITS[bucket];
  if (!limit) throw new Error(`checkAndConsumeMonthly: unknown bucket "${bucket}"`);

  if (isUnmetered(env, merchantId) || !env.DB) {
    return { ok: true, remaining: limit, used: 0, limit, bucket };
  }

  const key = monthlyKvKey(merchantId, bucket);

  // ── Fast path: KV cache ─────────────────────────────────────────────────
  if (env.HALA_CACHE) {
    try {
      const cached = await env.HALA_CACHE.get(key);
      const used = cached ? parseInt(cached, 10) : 0;

      if (used + cost > limit) {
        return { ok: false, remaining: 0, used, limit, bucket };
      }

      const newUsed = used + cost;
      env.HALA_CACHE.put(key, String(newUsed), { expirationTtl: MONTHLY_TTL_SECONDS }).catch(() => {});
      syncQuotaToD1(env, merchantId, bucket, cost).catch(() => {});

      return { ok: true, remaining: Math.max(0, limit - newUsed), used: newUsed, limit, bucket };
    } catch {
      // KV unavailable — fall through to D1
    }
  }

  // ── Cold path: D1 (source of truth) ────────────────────────────────────
  const period = currentMonth();
  const result = await env.DB.prepare(
    `INSERT INTO usage_quota (merchant_id, period, bucket, used, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT (merchant_id, period, bucket) DO UPDATE SET
       used = used + ?,
       updated_at = datetime('now')
     WHERE used + ? <= ?`
  )
    .bind(merchantId, period, bucket, cost, cost, cost, limit)
    .run();

  const row = await env.DB.prepare(
    "SELECT used FROM usage_quota WHERE merchant_id = ? AND period = ? AND bucket = ?"
  )
    .bind(merchantId, period, bucket)
    .first();
  const used = (row && row.used) || 0;

  if (env.HALA_CACHE && result.meta.changes > 0) {
    env.HALA_CACHE.put(key, String(used), { expirationTtl: MONTHLY_TTL_SECONDS }).catch(() => {});
  }

  return { ok: result.meta.changes > 0, remaining: Math.max(0, limit - used), used, limit, bucket };
}

/** Background D1 sync for the monthly quota's KV fast path. */
async function syncQuotaToD1(env, merchantId, bucket, cost) {
  const period = currentMonth();
  await env.DB.prepare(
    `INSERT INTO usage_quota (merchant_id, period, bucket, used, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT (merchant_id, period, bucket) DO UPDATE SET
       used = used + ?,
       updated_at = datetime('now')`
  )
    .bind(merchantId, period, bucket, cost, cost)
    .run();
}

/** Both monthly buckets for a merchant, for the dashboard's quota display. */
export async function getMonthlyUsage(env, merchantId) {
  const buckets = Object.keys(MONTHLY_BUCKET_LIMITS);
  const result = {};

  for (const bucket of buckets) {
    const limit = MONTHLY_BUCKET_LIMITS[bucket];
    if (isUnmetered(env, merchantId) || !env.DB) {
      result[bucket] = { used: 0, remaining: limit, limit };
      continue;
    }

    let used = 0;
    if (env.HALA_CACHE) {
      try {
        const cached = await env.HALA_CACHE.get(monthlyKvKey(merchantId, bucket));
        if (cached !== null) used = parseInt(cached, 10);
      } catch { /* fall through to D1 */ }
    }
    if (!used) {
      const row = await env.DB.prepare(
        "SELECT used FROM usage_quota WHERE merchant_id = ? AND period = ? AND bucket = ?"
      )
        .bind(merchantId, currentMonth(), bucket)
        .first();
      used = (row && row.used) || 0;
    }

    result[bucket] = { used, remaining: Math.max(0, limit - used), limit };
  }

  return result;
}

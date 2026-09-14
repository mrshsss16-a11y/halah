// Usage metering with KV-first fast path.
//
// Hot path (KV cache hit):
//   READ  KV  quota key → if under limit → WRITE KV increment → return ok
//   This cuts meter latency from ~60ms (2× D1 round-trips) to ~5ms (1× KV read).
//
// Cold path (first request of the day, or KV miss):
//   Falls back to atomic D1 INSERT..ON CONFLICT upsert.
//   D1 row is still the source of truth — KV is a performance overlay only.
//
// KV key format: meter:{merchantId}:{YYYY-MM-DD}
// KV TTL:        25h (auto-expires slightly after UTC midnight rollover)
const DAILY_LIMIT = 50;
const MONTHLY_FREE_LIMIT = 1000; // Meta's WhatsApp service-conversation free tier is uncapped since 2026-11-01 — this constant is unused, kept only as a documented historical note (see docs/ROADMAP.md m2.2.5).
// ── Merchant quota buckets (docs/ROADMAP.md m2.2.5) ─────────────────────────
// "hala" is Aura's own operational line, not a trial merchant — exempt from
// every bucket, same as the image-generation admin beta is exempt by gate.
export const MONTHLY_BUCKET_LIMITS = { message: 300, image: 20 };
// الأوصاف يومية منذ 2026-09-12 (قرار المالك): مصادر الذكاء الاصطناعي المجانية تتجدد يومياً
// (نحو ٢٥–٣٠ وصفاً باليوم للمشروع كله)، و٦٠ شهرياً بلا حد يومي تركت تاجراً واحداً يستهلك سعة
// يوم كامل على الجميع، ويحمّل هالة بتجربته المجانية فيولّد متجره كله ثم يحذفها.
export const DAILY_BUCKET_LIMITS = { description: 5 };
// سقف يومي للمشروع كله فوق حد كل متجر: يوقف التوليد برسالة صادقة قبل أن تنفد الحصص المجانية فجأة.
const GLOBAL_DAILY_LIMITS = { description: 25 };
// صف العدّاد العام بجدول usage_quota. لا يطابق معرّف تاجر (m_…) ولا يُمحى مع بيانات متجر.
const GLOBAL_ID = "_all";
const UNMETERED_MERCHANT_IDS = new Set(["hala"]);

/**
 * معفى من الحصة؟ `hala` ثابت بالكود (خط أورا التشغيلي). وفوقه قائمة
 * مؤقتة بمتغيّر البيئة `UNMETERED_MERCHANT_IDS` (معرّفات مفصولة بفواصل) —
 * أُضيفت 2026-09-10 لمتجر مراجعة سلة: مراجع يجرّب التوليد بالجملة على عشرين
 * منتجاً ويكرّر يصطدم بالسقف وسط التقييم. بمتغيّر لا بالكود: يُزال بسطر بعد
 * القبول بلا نشر، ولا يبقى معرّف تاجر إنتاجي محفوراً بالمصدر.
 *
 * الإعفاء للحصة **وحدها**: حدود المعدل (checkRateLimit) وحدّ سلة
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

function dailyKvKey(id, bucket, day) {
  return `quota:${id}:${bucket}:${day}`;
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

// ── D1 helpers for usage_quota (period = "YYYY-MM" monthly, "YYYY-MM-DD" daily) ──
function upsertQuota(env, id, period, bucket, cost, limit) {
  return env.DB.prepare(
    `INSERT INTO usage_quota (merchant_id, period, bucket, used, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT (merchant_id, period, bucket) DO UPDATE SET
       used = used + ?,
       updated_at = datetime('now')
     WHERE used + ? <= ?`
  )
    .bind(id, period, bucket, cost, cost, cost, limit)
    .run();
}

async function readQuota(env, id, period, bucket) {
  const row = await env.DB.prepare(
    "SELECT used FROM usage_quota WHERE merchant_id = ? AND period = ? AND bucket = ?"
  )
    .bind(id, period, bucket)
    .first();
  return (row && row.used) || 0;
}

/** Background D1 sync for a KV fast path — unconditional add (KV already enforced the limit). */
async function syncQuotaToD1(env, id, period, bucket, cost) {
  await env.DB.prepare(
    `INSERT INTO usage_quota (merchant_id, period, bucket, used, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT (merchant_id, period, bucket) DO UPDATE SET
       used = used + ?,
       updated_at = datetime('now')`
  )
    .bind(id, period, bucket, cost, cost)
    .run();
}

/**
 * حصة يومية لكل متجر + سقف يومي للمشروع كله. `scope` يقول أيهما رفض:
 * "store" = حد المتجر لليوم، "global" = اكتملت سعة هالة لليوم.
 */
async function consumeDaily(env, merchantId, bucket, cost) {
  const limit = DAILY_BUCKET_LIMITS[bucket];
  const globalLimit = GLOBAL_DAILY_LIMITS[bucket] ?? Infinity;
  const base = { limit, bucket, period: "day" };
  if (isUnmetered(env, merchantId) || !env.DB) return { ok: true, remaining: limit, used: 0, ...base };

  const day = today();
  const storeKey = dailyKvKey(merchantId, bucket, day);
  const globalKey = dailyKvKey(GLOBAL_ID, bucket, day);
  const hasGlobal = Number.isFinite(globalLimit);

  // القرار ذرّي بـD1 وحده (2026-09-14): مسار KV السابق كان «اقرأ ثم اكتب» — طلبان متوازيان يقرآن ٤
  // فيمرّ السادس والسابع. KV هنا **أرضية** فقط: عدّاده يبقى ٢٥ ساعة ولو مُحيت صفوف D1 بإزالة
  // التطبيق، فيُرفع صف D1 إليه قبل الحجز (MAX لا جمع) — إعادة التثبيت بنفس اليوم لا تصفّر الحد.
  const [kvUsed, kvGlobal] = await Promise.all([readCached(env, storeKey), hasGlobal ? readCached(env, globalKey) : null]);
  if ((kvUsed || 0) + cost > limit) return { ok: false, scope: "store", remaining: 0, used: kvUsed || 0, ...base };
  if (hasGlobal && (kvGlobal || 0) + cost > globalLimit) return { ok: false, scope: "global", remaining: 0, used: kvUsed || 0, ...base };
  if (kvUsed) await raiseQuotaFloor(env, merchantId, day, bucket, kvUsed).catch(() => {});
  if (hasGlobal && kvGlobal) await raiseQuotaFloor(env, GLOBAL_ID, day, bucket, kvGlobal).catch(() => {});

  const store = await upsertQuota(env, merchantId, day, bucket, cost, limit);
  if (!store.meta.changes) {
    return { ok: false, scope: "store", remaining: 0, used: await readQuota(env, merchantId, day, bucket), ...base };
  }
  if (hasGlobal) {
    const global = await upsertQuota(env, GLOBAL_ID, day, bucket, cost, globalLimit);
    if (!global.meta.changes) {
      await releaseD1(env, merchantId, day, bucket, cost);
      return { ok: false, scope: "global", remaining: 0, used: await readQuota(env, merchantId, day, bucket), ...base };
    }
  }
  const used = await readQuota(env, merchantId, day, bucket);
  await mirrorToKv(env, storeKey, used);
  if (hasGlobal) await mirrorToKv(env, globalKey, await readQuota(env, GLOBAL_ID, day, bucket));
  return { ok: true, remaining: Math.max(0, limit - used), used, ...base };
}

/** يرفع صف D1 إلى أرضية KV (بعد محو الصفوف) — لا يخفّضه أبداً. */
function raiseQuotaFloor(env, id, period, bucket, floor) {
  return env.DB.prepare(
    `INSERT INTO usage_quota (merchant_id, period, bucket, used, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT (merchant_id, period, bucket) DO UPDATE SET
       used = MAX(used, excluded.used),
       updated_at = datetime('now')`
  )
    .bind(id, period, bucket, floor)
    .run();
}

async function mirrorToKv(env, key, used) {
  if (!env.HALA_CACHE) return;
  try {
    await env.HALA_CACHE.put(key, String(used), { expirationTtl: METER_TTL_SECONDS });
  } catch { /* KV مرآة للعرض والأرضية فقط — D1 هو المصدر */ }
}

function releaseD1(env, id, period, bucket, cost) {
  return env.DB.prepare(
    "UPDATE usage_quota SET used = MAX(0, used - ?), updated_at = datetime('now') WHERE merchant_id = ? AND period = ? AND bucket = ?"
  )
    .bind(cost, id, period, bucket)
    .run();
}

/**
 * Quota check + consume for one bucket. The name is historical: "description" is
 * daily (per store + project-wide cap), "message" and "image" are monthly.
 * "hala" (Aura's own line) is always unmetered.
 *
 * @returns {Promise<{ok: boolean, remaining: number, used: number, limit: number, bucket: string, period?: string, scope?: string}>}
 */
export async function checkAndConsumeMonthly(env, merchantId, bucket, cost = 1) {
  if (DAILY_BUCKET_LIMITS[bucket]) return consumeDaily(env, merchantId, bucket, cost);

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
      syncQuotaToD1(env, merchantId, currentMonth(), bucket, cost).catch(() => {});

      return { ok: true, remaining: Math.max(0, limit - newUsed), used: newUsed, limit, bucket };
    } catch {
      // KV unavailable — fall through to D1
    }
  }

  // ── Cold path: D1 (source of truth) ────────────────────────────────────
  const period = currentMonth();
  const result = await upsertQuota(env, merchantId, period, bucket, cost, limit);
  const used = await readQuota(env, merchantId, period, bucket);

  if (env.HALA_CACHE && result.meta.changes > 0) {
    env.HALA_CACHE.put(key, String(used), { expirationTtl: MONTHLY_TTL_SECONDS }).catch(() => {});
  }

  return { ok: result.meta.changes > 0, remaining: Math.max(0, limit - used), used, limit, bucket };
}

/**
 * يعيد وحدة مستهلكة لم تُنتج شيئاً (فشل التوليد، نفاد سعة المزوّدين). بحد ٥ يومياً،
 * خصم محاولة فاشلة يأكل خُمس يوم التاجر بلا وصف. لا يرمي أبداً.
 */
export async function refundQuota(env, merchantId, bucket, cost = 1) {
  const daily = Boolean(DAILY_BUCKET_LIMITS[bucket]);
  if ((!daily && !MONTHLY_BUCKET_LIMITS[bucket]) || isUnmetered(env, merchantId) || !env?.DB) return;
  const period = daily ? today() : currentMonth();
  const ids = daily && Number.isFinite(GLOBAL_DAILY_LIMITS[bucket] ?? Infinity) ? [merchantId, GLOBAL_ID] : [merchantId];
  for (const id of ids) {
    const key = daily ? dailyKvKey(id, bucket, period) : monthlyKvKey(id, bucket);
    if (env.HALA_CACHE) {
      try {
        const cached = await env.HALA_CACHE.get(key);
        if (cached !== null) {
          await env.HALA_CACHE.put(key, String(Math.max(0, parseInt(cached, 10) - cost)), { expirationTtl: daily ? METER_TTL_SECONDS : MONTHLY_TTL_SECONDS });
        }
      } catch { /* KV unavailable */ }
    }
    await releaseD1(env, id, period, bucket, cost).catch(() => {});
  }
}

async function readCached(env, key) {
  if (!env.HALA_CACHE) return null;
  try {
    const cached = await env.HALA_CACHE.get(key);
    return cached !== null ? parseInt(cached, 10) : null;
  } catch {
    return null;
  }
}

/** Every bucket for a merchant, for the dashboard's quota display and bulk planning. */
export async function getMonthlyUsage(env, merchantId) {
  const result = {};

  for (const bucket of Object.keys(DAILY_BUCKET_LIMITS)) {
    const limit = DAILY_BUCKET_LIMITS[bucket];
    if (isUnmetered(env, merchantId) || !env.DB) {
      result[bucket] = { used: 0, remaining: limit, limit, period: "day" };
      continue;
    }
    const day = today();
    const used = (await readCached(env, dailyKvKey(merchantId, bucket, day))) ?? (await readQuota(env, merchantId, day, bucket));
    const globalLimit = GLOBAL_DAILY_LIMITS[bucket] ?? Infinity;
    const globalUsed = Number.isFinite(globalLimit)
      ? (await readCached(env, dailyKvKey(GLOBAL_ID, bucket, day))) ?? (await readQuota(env, GLOBAL_ID, day, bucket))
      : 0;
    // المتبقي الفعلي = الأقل بين حد المتجر وسعة اليوم العامة: خطة التوليد بالجملة لا تعد بما لن يُصرف اليوم.
    const remaining = Math.max(0, Math.min(limit - used, globalLimit - globalUsed));
    result[bucket] = { used, remaining, limit, period: "day" };
  }

  for (const bucket of Object.keys(MONTHLY_BUCKET_LIMITS)) {
    const limit = MONTHLY_BUCKET_LIMITS[bucket];
    if (isUnmetered(env, merchantId) || !env.DB) {
      result[bucket] = { used: 0, remaining: limit, limit };
      continue;
    }
    let used = (await readCached(env, monthlyKvKey(merchantId, bucket))) || 0;
    if (!used) used = await readQuota(env, merchantId, currentMonth(), bucket);
    result[bucket] = { used, remaining: Math.max(0, limit - used), limit };
  }

  return result;
}

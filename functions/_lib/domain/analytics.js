// مجال الإحصاءات ومتابعة الإطلاق: عدّادات لوحة الأدمن، مؤشرات الإطلاق المحدود،
// نشاط التجّار، وتقييماتهم. نُقل من core/db.js بالمرحلة ٣ بلا تغيير سلوكي.
//
// كل استعلام هنا عابر للمتاجر **بالتصميم** — مستدعوه كلهم خلف `requireAdmin`.
// وسوم `tenant-audit-ok` منقولة مع استعلاماتها حرفياً كما كانت.

// ── Admin dashboard counters (read-only, no raw SQL exposed to the client) ──

export async function adminStats(env) {
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  // tenant-audit-ok: admin-only aggregate counters across ALL merchants —
  // only caller is api/admin/overview.js, gated by requireAdmin. This is the
  // one function in this shared file that's intentionally cross-tenant.
  const [merchants, accounts, bookings, faqEntries, todayUsage] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM merchants").first(),
    // tenant-audit-ok: admin-only global counter, see file-level note above.
    env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM consultation_bookings").first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM hala_faq").first(),
    // tenant-audit-ok: admin-only global counter, see file-level note above.
    env.DB.prepare("SELECT SUM(credits_used) AS total FROM usage_meter WHERE day = ?").bind(todayStr).first().catch(() => ({ total: 0 }))
  ]);
  return {
    merchants: merchants?.n ?? 0,
    accounts: accounts?.n ?? 0,
    bookings: bookings?.n ?? 0,
    faqEntries: faqEntries?.n ?? 0,
    totalCreditsUsedToday: todayUsage?.total ?? 0
  };
}

// ── المرحلة ٤: متابعة الإطلاق المحدود (migrations/0024) ───────────────────

export async function saveMerchantFeedback(env, { merchantId, score, comment = null, context = null }) {
  const res = await env.DB.prepare(
    "INSERT INTO merchant_feedback (merchant_id, score, comment, context) VALUES (?, ?, ?, ?)"
  )
    .bind(merchantId, score, comment, context)
    .run();
  return res?.meta?.last_row_id ?? null;
}

// tenant-audit-ok: قراءة أدمن عابرة للمتاجر بالتصميم — المستدعي الوحيد api/admin/launch.js خلف requireAdmin + سطر تدقيق.
export async function listMerchantFeedback(env, limit = 30) {
  const { results } = await env.DB.prepare(
    `SELECT f.id, f.merchant_id, f.score, f.comment, f.context, f.created_at, m.store_name
       FROM merchant_feedback f LEFT JOIN merchants m ON m.id = f.merchant_id
      ORDER BY f.created_at DESC LIMIT ?`
  )
    .bind(Math.min(Math.max(Number(limit) || 30, 1), 200))
    .all();
  return results || [];
}

// tenant-audit-ok: قراءة أدمن عابرة للمتاجر بالتصميم (api/admin/launch.js فقط).
export async function listMerchantActivity(env, limit = 50) {
  const { results } = await env.DB.prepare(
    `SELECT m.id AS merchant_id, m.store_name, m.created_at, m.last_active_at,
            a.email, a.disabled,
            (SELECT COUNT(*) FROM store_products p WHERE p.merchant_id = m.id) AS catalog_count,
            (SELECT COUNT(*) FROM review_queue r WHERE r.merchant_id = m.id AND r.kind = 'description' AND r.published_at IS NOT NULL) AS published_count,
            (SELECT COUNT(*) FROM whatsapp_messages w WHERE w.merchant_id = m.id AND w.created_at >= datetime('now', '-7 days')) AS wa_7d
       FROM merchants m LEFT JOIN accounts a ON a.merchant_id = m.id
      ORDER BY COALESCE(m.last_active_at, m.created_at) DESC LIMIT ?`
  )
    .bind(Math.min(Math.max(Number(limit) || 50, 1), 200))
    .all();
  return (results || []).map((r) => ({
    merchantId: r.merchant_id,
    storeName: r.store_name || null,
    email: r.email || null,
    disabled: Boolean(r.disabled),
    createdAt: r.created_at,
    lastActiveAt: r.last_active_at || null,
    catalogCount: Number(r.catalog_count || 0),
    publishedCount: Number(r.published_count || 0),
    waMessages7d: Number(r.wa_7d || 0)
  }));
}

// tenant-audit-ok: عدّادات أدمن عابرة للمتاجر بالتصميم — كلها لـapi/admin/launch.js خلف requireAdmin.
export async function launchStats(env) {
  const q = (sql, ...binds) => env.DB.prepare(sql).bind(...binds).first().catch(() => null);
  const [active7d, active1d, merchants, waIn7d, waOut7d, widget7d, generated7d, published7d, bookings7d,
         errors24h, pendingReview, awaitingPublish, publishFailed, feedbackAgg] = await Promise.all([
    // tenant-audit-ok: عدّاد أدمن عابر للمتاجر (launch monitor، خلف requireAdmin)
    q("SELECT COUNT(*) AS n FROM merchants WHERE last_active_at >= datetime('now', '-7 days')"),
    // tenant-audit-ok: عدّاد أدمن عابر للمتاجر (launch monitor، خلف requireAdmin)
    q("SELECT COUNT(*) AS n FROM merchants WHERE last_active_at >= datetime('now', '-1 day')"),
    // tenant-audit-ok: عدّاد أدمن عابر للمتاجر (launch monitor، خلف requireAdmin)
    q("SELECT COUNT(*) AS n FROM merchants"),
    // tenant-audit-ok: عدّاد أدمن عابر للمتاجر (launch monitor، خلف requireAdmin)
    q("SELECT COUNT(*) AS n FROM whatsapp_messages WHERE direction = 'in' AND created_at >= datetime('now', '-7 days')"),
    // tenant-audit-ok: عدّاد أدمن عابر للمتاجر (launch monitor، خلف requireAdmin)
    q("SELECT COUNT(*) AS n FROM whatsapp_messages WHERE direction = 'out' AND created_at >= datetime('now', '-7 days')"),
    // tenant-audit-ok: عدّاد أدمن عابر للمتاجر (launch monitor، خلف requireAdmin)
    q("SELECT COUNT(*) AS n FROM omnichannel_sessions WHERE updated_at >= datetime('now', '-7 days')"),
    // tenant-audit-ok: عدّاد أدمن عابر للمتاجر (launch monitor، خلف requireAdmin)
    q("SELECT COUNT(*) AS n FROM review_queue WHERE kind = 'description' AND created_at >= datetime('now', '-7 days')"),
    // tenant-audit-ok: عدّاد أدمن عابر للمتاجر (launch monitor، خلف requireAdmin)
    q("SELECT COUNT(*) AS n FROM review_queue WHERE kind = 'description' AND published_at >= datetime('now', '-7 days')"),
    // tenant-audit-ok: عدّاد أدمن عابر للمتاجر (launch monitor، خلف requireAdmin)
    q("SELECT COUNT(*) AS n FROM consultation_bookings WHERE created_at >= datetime('now', '-7 days')"),
    // tenant-audit-ok: عدّاد أدمن عابر للمتاجر (launch monitor، خلف requireAdmin)
    q("SELECT COUNT(*) AS n FROM error_log WHERE created_at >= datetime('now', '-1 day')"),
    // tenant-audit-ok: عدّاد أدمن عابر للمتاجر (launch monitor، خلف requireAdmin)
    q("SELECT COUNT(*) AS n FROM review_queue WHERE kind = 'description' AND status = 'pending'"),
    // tenant-audit-ok: عدّاد أدمن عابر للمتاجر (launch monitor، خلف requireAdmin)
    q("SELECT COUNT(*) AS n FROM review_queue WHERE kind = 'description' AND status = 'approved' AND published_at IS NULL AND publish_error IS NULL"),
    // tenant-audit-ok: عدّاد أدمن عابر للمتاجر (launch monitor، خلف requireAdmin)
    q("SELECT COUNT(*) AS n FROM review_queue WHERE kind = 'description' AND status = 'approved' AND published_at IS NULL AND publish_error IS NOT NULL"),
    // tenant-audit-ok: عدّاد أدمن عابر للمتاجر (launch monitor، خلف requireAdmin)
    q("SELECT COUNT(*) AS n, AVG(score) AS avg FROM merchant_feedback WHERE created_at >= datetime('now', '-30 days')")
  ]);
  // tenant-audit-ok: عدّاد أدمن عابر للمتاجر (launch monitor، خلف requireAdmin)
  const topErrors = await env.DB.prepare(
    "SELECT code, COUNT(*) AS n FROM error_log WHERE created_at >= datetime('now', '-1 day') GROUP BY code ORDER BY n DESC LIMIT 5"
  ).all().then((r) => r.results || []).catch(() => []);
  const n = (row) => Number(row?.n || 0);
  return {
    merchantsTotal: n(merchants),
    activeMerchants7d: n(active7d),
    activeMerchants1d: n(active1d),
    whatsappIn7d: n(waIn7d),
    whatsappOut7d: n(waOut7d),
    widgetSessions7d: widget7d === null ? null : n(widget7d),
    descriptionsGenerated7d: n(generated7d),
    descriptionsPublished7d: n(published7d),
    bookings7d: n(bookings7d),
    errors24h: n(errors24h),
    topErrors24h: topErrors.map((e) => ({ code: e.code, count: Number(e.n) })),
    reviewPending: n(pendingReview),
    reviewAwaitingPublish: n(awaitingPublish),
    reviewPublishFailed: n(publishFailed),
    feedbackCount30d: n(feedbackAgg),
    feedbackAvg30d: feedbackAgg?.avg === null || feedbackAgg?.avg === undefined ? null : Math.round(Number(feedbackAgg.avg) * 10) / 10
  };
}

// ── المرحلة ٤: SQL كان بـ`api/stats.js` و`api/admin/errors.js` ──────────────

/**
 * أرقام صفحة الهبوط العلنية — حقيقية فقط (§١١ الصدق: لا دليل اجتماعي مفبرك).
 * جدول ناقص أو عمود مُعاد تسميته يجب ألا يُسقط النقطة كلها: ننزل إلى صفر
 * ونسجّل، لأن هذه عدّادات علنية لا مسار حرج.
 * tenant-audit-ok: تجميع عابر لكل المتاجر بالتصميم — المخرج رقم واحد مُجمَّع،
 * ولا سياق متجر بهذا المسار أصلاً (نقطة عامة بلا جلسة).
 */
export async function publicStats(env, onQueryError = () => {}) {
  const scalar = async (sql, key, fallback = 0) => {
    if (!env?.DB) return fallback;
    const row = await env.DB.prepare(sql)
      .first()
      .catch((err) => {
        onQueryError(key, err);
        return null;
      });
    return row?.[key] ?? fallback;
  };

  // ملاحظة: `abandoned_carts` تخزّن قيمة السلة بعمود `total` لا `amount`
  // (migrations/0002_copy_and_whatsapp.sql).
  const [recoveredSalesSAR, consultationTickets, cacheSavingRate] = await Promise.all([
    scalar("SELECT SUM(total) AS v FROM abandoned_carts WHERE status = 'recovered'", "v"),
    scalar("SELECT COUNT(*) AS v FROM consultation_bookings", "v"),
    scalar(
      "SELECT (CAST(SUM(CASE WHEN response_time_ms < 5 THEN 1 ELSE 0 END) AS REAL) / COUNT(*)) * 100 AS v FROM hala_cache",
      "v"
    )
  ]);

  return { recoveredSalesSAR, consultationTickets, halaCacheSavingRate: cacheSavingRate };
}

/**
 * آخر صفوف `error_log` (D3). عابر لكل المتاجر عمداً — شاشة أدمن، لا شاشة تاجر
 * (`requireAdmin` بنقطة الدخول هو الحارس، مثل accounts.js وbookings.js).
 * tenant-audit-ok: سجل أخطاء إداري عابر للمستأجرين؛ `storeId` مرشّح اختياري
 * يمرّره الأدمن، لا شرط عزل.
 */
export async function listErrorLog(env, { storeId = null, limit = 50 } = {}) {
  let query = "SELECT id, request_id, store_id, code, path, internal, created_at FROM error_log";
  const params = [];
  if (storeId) {
    query += " WHERE store_id = ?";
    params.push(storeId);
  }
  query += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const { results } = await env.DB.prepare(query).bind(...params).all();
  return results || [];
}

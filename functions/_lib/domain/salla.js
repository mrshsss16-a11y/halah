// مجال سلة: تخزين توكنات OAuth وتجديدها، ربط التاجر بمعرّف متجره، وحالة الربط.
// نُقل من core/db.js + من `integrations/salla.js` بالمرحلة ٣ (ARCHITECTURE §٢):
// **المحوّل لم يعد يقرأ قاعدة البيانات** — التوكن يُجلَب هنا ويُمرَّر له.
import { encryptSecret, decryptSecret } from "../core/crypto.js";
import { sanitizeInput } from "../core/security.js";
import { refreshSallaToken } from "../integrations/salla.js";

const REFRESH_MARGIN_S = 24 * 3600; // renew when less than a day remains

export async function getMerchantBySalla(env, sallaMerchantId) {
  return env.DB.prepare("SELECT * FROM merchants WHERE salla_merchant_id = ?")
    .bind(String(sallaMerchantId))
    .first();
}

export async function upsertMerchantFromSalla(env, { sallaMerchantId, storeName }) {
  // A merchant controls their own Salla store name; it renders in the admin
  // accounts table (SECURITY_AUDIT C3). Escaping at the sink is the primary
  // fix — this strips tags at the source as defence in depth.
  storeName = storeName ? sanitizeInput(String(storeName), 100) : storeName;
  const existing = await getMerchantBySalla(env, sallaMerchantId);
  if (existing) {
    if (storeName && storeName !== existing.store_name) {
      await env.DB.prepare("UPDATE merchants SET store_name = ? WHERE id = ?")
        .bind(storeName, existing.id)
        .run();
    }
    return existing.id;
  }
  const id = `m_${crypto.randomUUID().slice(0, 12)}`;
  await env.DB.prepare(
    "INSERT INTO merchants (id, salla_merchant_id, store_name) VALUES (?, ?, ?)"
  )
    .bind(id, String(sallaMerchantId), storeName || null)
    .run();
  return id;
}

export async function saveTokens(env, { merchantId, platform, accessToken, refreshToken, expiresAt }) {
  const encAccess = await encryptSecret(env, accessToken);
  const encRefresh = await encryptSecret(env, refreshToken);
  await env.DB.prepare(
    `INSERT INTO oauth_tokens (merchant_id, platform, access_token, refresh_token, expires_at, refresh_lock, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
     ON CONFLICT (merchant_id, platform) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       refresh_lock = 0,
       updated_at = datetime('now')`
  )
    .bind(merchantId, platform, encAccess, encRefresh, expiresAt)
    .run();
}

// oauth_tokens.access_token/refresh_token are encrypted at rest (see
// functions/_lib/core/crypto.js) — decrypt on the way out so every caller keeps
// working with plaintext tokens exactly as before.
export async function getTokens(env, merchantId, platform) {
  const row = await env.DB.prepare("SELECT * FROM oauth_tokens WHERE merchant_id = ? AND platform = ?")
    .bind(merchantId, platform)
    .first();
  if (!row) return null;
  return {
    ...row,
    access_token: await decryptSecret(env, row.access_token),
    refresh_token: await decryptSecret(env, row.refresh_token)
  };
}

/**
 * Try to acquire the refresh mutex. Returns true when this caller won and
 * must perform the refresh; false when another request holds the lock.
 * Stale locks (>60s old) are stealable to survive crashed refreshes.
 */
export async function acquireRefreshLock(env, merchantId, platform) {
  const result = await env.DB.prepare(
    `UPDATE oauth_tokens SET refresh_lock = 1, updated_at = datetime('now')
     WHERE merchant_id = ? AND platform = ?
       AND (refresh_lock = 0 OR updated_at < datetime('now', '-60 seconds'))`
  )
    .bind(merchantId, platform)
    .run();
  return result.meta.changes > 0;
}

export async function releaseRefreshLock(env, merchantId, platform) {
  await env.DB.prepare(
    "UPDATE oauth_tokens SET refresh_lock = 0 WHERE merchant_id = ? AND platform = ?"
  )
    .bind(merchantId, platform)
    .run();
}

// ── تجديد التوكن (كان بـintegrations/salla.js قبل المرحلة ٣) ────────────────
// توكن الوصول يعيش ١٤ يوماً، وتوكن التجديد **يُستخدم مرة واحدة**: تجديدان
// متوازيان يُبطلان التفويض كاملاً (يفرضان إعادة تثبيت التطبيق)، ولهذا مسار
// التجديد محروس بقفل `refresh_lock` بـD1.
async function refreshTokens(env, merchantId, tokens) {
  const won = await acquireRefreshLock(env, merchantId, "salla");
  if (!won) {
    // Another request is refreshing — wait briefly, then re-read.
    await new Promise((r) => setTimeout(r, 1500));
    const fresh = await getTokens(env, merchantId, "salla");
    if (fresh && fresh.expires_at * 1000 > Date.now()) return fresh;
    throw new Error("token refresh in progress elsewhere; retry shortly");
  }
  try {
    const data = await refreshSallaToken({
      refreshToken: tokens.refresh_token,
      clientId: env.SALLA_CLIENT_ID,
      clientSecret: env.SALLA_CLIENT_SECRET
    });
    await saveTokens(env, {
      merchantId,
      platform: "salla",
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Math.floor(Date.now() / 1000) + (Number(data.expires_in) || 14 * 24 * 3600)
    });
    return getTokens(env, merchantId, "salla");
  } finally {
    await releaseRefreshLock(env, merchantId, "salla").catch(() => {});
  }
}

/**
 * التوكن الصالح لهذا التاجر — يجدّده تلقائياً قبل انتهائه بيوم.
 * هذا هو **المصدر الوحيد** الذي يمرّر التوكن لمحوّل سلة الخالص.
 */
export async function getValidSallaToken(env, merchantId) {
  let tokens = await getTokens(env, merchantId, "salla");
  if (!tokens) {
    throw new Error("المتجر غير مرتبط بسلة — ثبّت التطبيق من متجر سلة أولاً.");
  }
  const now = Math.floor(Date.now() / 1000);
  if (tokens.expires_at - now < REFRESH_MARGIN_S) {
    tokens = await refreshTokens(env, merchantId, tokens);
  }
  return tokens.access_token;
}

// ── فك الربط بسلة (migrations/0025) ────────────────────────────────────────

/**
 * يقطع وصول هالة لمتجر التاجر فوراً عند حذفه التطبيق (`app.uninstalled`).
 *
 * كان هذا الحدث **غير معالَج إطلاقاً**: التاجر يحذف التطبيق ويبقى توكن وصوله
 * محفوظاً عندنا للأبد — صلاحية على متجر لم يعد يأذن لنا (Q3 بـdocs/DEFERRED.md).
 *
 * ما يحدث بالضبط:
 *   ١. **حذف** توكنات سلة — لا تعطيل. توكن محفوظ بلا إذن دَين أمني لا سجل.
 *   ٢. إلغاء أي مهمة جملة قيد التشغيل — وإلا ظل الـcron يطرق باب متجر مغلق
 *      ويستهلك حد المعدل ويملأ سجل الأخطاء بفشل متوقع.
 *   ٣. ختم `salla_disconnected_at` ليعرض الداشبورد الحالة بصدق.
 *
 * بيانات المتجر (المنتجات، الأوصاف المعتمدة، الطابور) **تبقى**: التاجر قد
 * يعيد التثبيت، و`upsertMerchantFromSalla` يعيده لنفس `merchantId` فيستأنف
 * من حيث وقف. الحذف الكامل مسار منفصل بطلب صريح (data-deletion.html).
 */
export async function revokeSallaConnection(env, merchantId) {
  if (!env?.DB || !merchantId) return { revoked: false };
  const stmts = [
    env.DB.prepare("DELETE FROM oauth_tokens WHERE merchant_id = ? AND platform = 'salla'").bind(merchantId),
    env.DB.prepare("UPDATE bulk_jobs SET status = 'cancelled', updated_at = datetime('now') WHERE merchant_id = ? AND status = 'running'").bind(merchantId),
    env.DB.prepare("UPDATE merchants SET salla_disconnected_at = datetime('now') WHERE id = ?").bind(merchantId)
  ];
  await env.DB.batch(stmts);
  return { revoked: true, merchantId };
}

/** حالة الربط كما تُعرض للتاجر — بلا ادعاء "مربوط" لمتجر بلا توكن. */
export async function getSallaConnectionState(env, merchantId) {
  if (!env?.DB || !merchantId) return { connected: false, disconnectedAt: null };
  const row = await env.DB.prepare(
    `SELECT m.salla_disconnected_at AS d,
            (SELECT COUNT(*) FROM oauth_tokens t WHERE t.merchant_id = m.id AND t.platform = 'salla') AS n
       FROM merchants m WHERE m.id = ?`
  )
    .bind(merchantId)
    .first()
    .catch(() => null);
  return { connected: Number(row?.n || 0) > 0, disconnectedAt: row?.d || null };
}

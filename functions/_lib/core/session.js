import { getAccountEmail, getMerchant } from "./db.js";
import { ApiError } from "./respond.js";
// Q1 — نسخة واحدة للمقارنة الثابتة الزمن (كانت مكرّرة هنا وبـoauthState.js وreset_password.js).
import { timingSafeEqualStr } from "./crypto.js";
import { logError } from "./errorLog.js";

// Ids an anonymous caller must never be able to claim through a request body.
// "hala" is Aura's own line and is UNMETERED in meter.js — letting a stranger
// name it (or any reserved id) would run AI with no quota at that tenant's
// expense (SECURITY_AUDIT C2/H7).
export const RESERVED_STORE_IDS = new Set(["hala"]);

// Signed session cookie. Token shape (P40, migrations/0023):
// `${merchantId}.${expiryUnix}.${sessionVersion}.${hmacHex}`,
// HMAC-SHA256(SESSION_SECRET, `${merchantId}.${expiryUnix}.${sessionVersion}`).
//
// `sessionVersion` mirrors accounts.session_version. Logout, password reset and
// account disable bump it; any token carrying an older version fails verification,
// so a stolen cookie dies with the event instead of living out its 30 days.
// The current version is read from KV (`sv:<merchantId>`, 1h TTL) and falls back
// to D1. A merchant with NO accounts row (Salla Easy-Mode install) has version 0.
// Read failure on both = fail closed (no session), per §7 "absence = error".
//
// Legacy 3-part tokens (issued before 0023) are accepted ONLY as version 0 — the
// migration seeds every account at 0, so nobody is logged out by the deploy, and
// the first bump retires them all.
const COOKIE_NAME = "hala_session";
const SESSION_DAYS = 30;
const VERSION_TTL_SECONDS = 3600;
const versionKey = (merchantId) => `sv:${merchantId}`;

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getSessionSecret(env) {
  if (env?.SESSION_SECRET) {
    return env.SESSION_SECRET;
  }
  // No derivation from other secrets: WHATSAPP_TOKEN rotates (hourly for temp
  // tokens) which would silently invalidate every session, and reusing an
  // integration secret weakens session integrity. Fail closed instead.
  throw new ApiError(500, "متغير البيئة SESSION_SECRET غير معرف. يرجى ضبطه في إعدادات البيئة.", "SESSION_SECRET_MISSING");
}

/**
 * Current session_version for a merchant. KV first, D1 second, then fail closed
 * (returns null → caller treats the session as invalid). No accounts row = 0.
 */
export async function currentSessionVersion(env, merchantId) {
  const kv = env?.HALA_CACHE;
  if (kv) {
    // Q2 — فشل KV هنا يسقط للـD1 (سلوك مقصود)، لكنه يُسجَّل بدل الابتلاع الصامت.
    const cached = await kv.get(versionKey(merchantId)).catch((err) => {
      logError({ env }, { requestId: null, path: "core/session.currentSessionVersion", code: "SESSION_VERSION_KV_READ_FAILED", storeId: merchantId, internal: err?.message || String(err) });
      return null;
    });
    if (cached !== null && cached !== undefined && cached !== "") {
      const n = Number(cached);
      if (Number.isInteger(n) && n >= 0) return n;
    }
  }
  if (!env?.DB) return null;
  let row;
  try {
    row = await env.DB.prepare("SELECT session_version FROM accounts WHERE merchant_id = ?").bind(merchantId).first();
  } catch (err) {
    // Q2 — فشل قراءة نسخة الجلسة يعني رفض كل الجلسات (fail closed). كان يمر
    // بصمت فيبدو الأمر «انتهاء صلاحية» عشوائياً بلا أي أثر للتشخيص.
    logError({ env }, { requestId: null, path: "core/session.currentSessionVersion", code: "SESSION_VERSION_READ_FAILED", storeId: merchantId, internal: err?.message || String(err) });
    return null;
  }
  const version = row ? Number(row.session_version) || 0 : 0;
  if (kv) kv.put(versionKey(merchantId), String(version), { expirationTtl: VERSION_TTL_SECONDS }).catch(() => {});
  return version;
}

/**
 * Invalidate every live session of a merchant: bump the column, refresh the KV
 * mirror. Called by logout, password reset and account disable. A merchant with
 * no accounts row has nothing to bump (their id is their only credential).
 */
export async function bumpSessionVersion(env, merchantId) {
  if (!env?.DB || !merchantId) return null;
  const row = await env.DB.prepare(
    "UPDATE accounts SET session_version = session_version + 1 WHERE merchant_id = ? RETURNING session_version"
  )
    .bind(merchantId)
    .first();
  const version = row ? Number(row.session_version) : null;
  if (version !== null && env?.HALA_CACHE) {
    // Q2 — فشل تحديث مرآة KV يعني أن الجلسات القديمة تبقى صالحة حتى انتهاء
    // الـTTL (ساعة) رغم أن السبب كان تسجيل خروج/إعادة تعيين كلمة مرور. لا
    // يُبتلع بصمت: يُسجَّل بلا PII حتى يظهر بصفحة أخطاء الأدمن.
    await env.HALA_CACHE.put(versionKey(merchantId), String(version), { expirationTtl: VERSION_TTL_SECONDS }).catch((err) =>
      logError({ env }, { requestId: null, path: "core/session.bumpSessionVersion", code: "SESSION_VERSION_KV_WRITE_FAILED", storeId: merchantId, internal: err?.message || String(err) })
    );
  }
  return version;
}

export async function createSessionToken(env, merchantId) {
  const secret = getSessionSecret(env);
  const expiry = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 3600;
  const version = (await currentSessionVersion(env, merchantId)) ?? 0;
  const payload = `${merchantId}.${expiry}.${version}`;
  const mac = await hmacHex(secret, payload);
  return `${payload}.${mac}`;
}

export async function verifySessionToken(env, token) {
  if (!token) return null;
  const secret = getSessionSecret(env);
  const parts = token.split(".");
  let merchantId, expiryStr, versionStr, mac;
  if (parts.length === 4) {
    [merchantId, expiryStr, versionStr, mac] = parts;
  } else if (parts.length === 3) {
    [merchantId, expiryStr, mac] = parts;
    versionStr = null; // legacy token — signed without a version, valid only at version 0
  } else {
    return null;
  }
  const expiry = Number(expiryStr);
  if (!merchantId || !Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return null;
  const signed = versionStr === null ? `${merchantId}.${expiryStr}` : `${merchantId}.${expiryStr}.${versionStr}`;
  const expectedMac = await hmacHex(secret, signed);
  if (!timingSafeEqualStr(mac, expectedMac)) return null;

  const tokenVersion = versionStr === null ? 0 : Number(versionStr);
  if (!Number.isInteger(tokenVersion) || tokenVersion < 0) return null;
  const current = await currentSessionVersion(env, merchantId);
  if (current === null) return null; // fail closed: cannot confirm the version
  if (tokenVersion !== current) return null;
  return merchantId;
}

function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const map = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) map[key] = decodeURIComponent(value);
  });
  return map;
}

export function sessionCookieHeader(token, { clear = false } = {}) {
  const maxAge = clear ? 0 : SESSION_DAYS * 24 * 3600;
  const value = clear ? "" : token;
  // SameSite=None (not Lax) is required for dashboard.html when it runs
  // embedded inside Salla's dashboard iframe (a cross-site context from the
  // browser's point of view — halah.aura.sa framed by s.salla.sa). Lax
  // cookies are dropped by the browser in that context: the login/verify
  // fetch would succeed (200, Set-Cookie present) but the cookie never
  // actually persists, so the very next request looks logged-out — no error,
  // the merchant just gets silently bounced back. Still HttpOnly + Secure +
  // a signed token, so this doesn't weaken anything meaningful; SameSite=Lax
  // was only ever protecting against a scenario (cross-site top-level GET
  // navigation carrying the cookie) that doesn't apply to an API cookie like
  // this one.
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`;
}

export async function getSessionMerchantId(request, env) {
  const cookies = parseCookies(request);
  return verifySessionToken(env, cookies[COOKIE_NAME]);
}

/**
 * The core tenant-isolation rule, two layers:
 *
 * 1. A valid session cookie always wins over whatever storeId the client
 *    claims in the request body — a logged-in attacker can never operate on
 *    someone else's store by swapping ids.
 * 2. With no session, a claimed storeId is only honored when it names a REAL
 *    Salla-install merchant that has NO account attached. Those stores have no
 *    login — their unguessable id (m_ + truncated random) is their only
 *    credential, so it must keep working. But:
 *      - the moment a merchant signs up, their data is reachable exclusively
 *        through a session (a leaked/guessed id alone gets 401 LOGIN_REQUIRED);
 *      - a claimed id that matches NO merchant row is rejected back to the
 *        shared "default-store" bucket instead of being trusted verbatim. The
 *        old code returned any unknown string as its own tenant, so an
 *        anonymous caller could mint unlimited fresh quota buckets by inventing
 *        ids (SECURITY_AUDIT C2 — denial of wallet);
 *      - reserved ids (see RESERVED_STORE_IDS) are never claimable anonymously.
 *
 * The anonymous demo flow ("default-store") is untouched.
 */
const ACTIVE_TTL_SECONDS = 600;

/**
 * merchants.last_active_at (migrations/0024) — a real "is anyone using this?"
 * signal for the limited launch. KV-throttled to one D1 write per merchant per
 * 10 minutes; fire-and-forget so it never delays or fails a request.
 */
export function touchLastActive(env, merchantId) {
  if (!env?.DB || !merchantId) return;
  const kv = env.HALA_CACHE;
  const key = `la:${merchantId}`;
  const run = async () => {
    if (kv && (await kv.get(key).catch(() => null))) return;
    await env.DB.prepare("UPDATE merchants SET last_active_at = datetime('now') WHERE id = ?").bind(merchantId).run();
    if (kv) await kv.put(key, "1", { expirationTtl: ACTIVE_TTL_SECONDS }).catch(() => {});
  };
  run().catch(() => {});
}

export async function resolveStoreId(request, env, claimedStoreId) {
  const sessionMerchantId = await getSessionMerchantId(request, env);
  const claimed = (claimedStoreId || "default-store").toString().slice(0, 40);

  if (sessionMerchantId) {
    touchLastActive(env, sessionMerchantId);
    if (claimed !== "default-store" && claimed !== sessionMerchantId) {
      const admin = await requireAdmin(request, env);
      if (admin) return claimed;
    }
    return sessionMerchantId;
  }

  // ── Anonymous from here down ──────────────────────────────────────────────
  if (claimed === "default-store") return claimed;

  // A stranger can never name a reserved tenant (e.g. the unmetered "hala").
  if (RESERVED_STORE_IDS.has(claimed)) {
    throw new ApiError(401, "غير مصرح.", "LOGIN_REQUIRED");
  }

  // Registered store → session required.
  if (await getAccountEmail(env, claimed)) {
    throw new ApiError(401, "هذا المتجر مرتبط بحساب — سجّل دخولك للوصول له.", "LOGIN_REQUIRED");
  }

  // Only a real, account-less Salla-install merchant may be addressed by id
  // alone. An id matching no merchant row is NOT trusted as its own tenant —
  // it falls back to the shared demo bucket so it can't farm free quota.
  const merchant = env?.DB ? await getMerchant(env, claimed).catch(() => null) : null;
  if (!merchant) return "default-store";
  return claimed;
}

/**
 * Same tenant resolution as resolveStoreId(), MINUS the anonymous
 * "default-store" demo bucket.
 *
 * Why it exists (2026-09-07): resolveStoreId() falling back to "default-store"
 * is correct for the anonymous website widget, but /api/copy, /api/chat and
 * /api/image inherited it too — so a full commercial copy + SEO engine (and an
 * image generator, and the store chat model) ran for anyone on the internet
 * with no account at all. Live-verified: `POST /api/copy` with no cookie
 * returned a complete product description + JSON-LD schema.
 *
 * Callers that spend an AI model call on merchant-facing work must use this
 * instead. Still honored without a session: a REAL account-less Salla
 * Easy-Mode merchant addressed by its unguessable m_ id — that install flow
 * has no login and is metered per tenant. Salla dashboard merchants get a
 * proper session cookie via /api/auth/salla_embedded, so the embedded flow is
 * unaffected either way.
 *
 * Intentionally NOT applied to /api/support (Aura's own visitor widget, fixed
 * storeId "hala", rate limited) or the WhatsApp webhook (signature verified) —
 * those are deliberate public channels.
 */
export async function resolveMerchantStoreId(request, env, claimedStoreId) {
  const storeId = await resolveStoreId(request, env, claimedStoreId);
  if (storeId === "default-store") {
    throw new ApiError(401, "سجّل دخولك أولاً.", "LOGIN_REQUIRED");
  }
  return storeId;
}

/**
 * Gate for "real operations" — anything that spends our AI budget, writes to
 * the merchant's Salla store, or binds an external channel (WhatsApp).
 *
 * Decision (option ب, project owner 2026-09-07): a Salla merchant installs the
 * app and lands in the dashboard INSTANTLY with no registration of ours — the
 * webhook `app.store.authorize` creates the `merchants` row and
 * /api/auth/salla_embedded issues a full session. That immediate value is the
 * Easy-Mode experience Salla reviews, so we do NOT block the door. We block the
 * first real operation instead.
 *
 * Three distinct outcomes, deliberately NOT collapsed into one:
 *   1. Fully anonymous (no session, no addressable merchant)
 *        → 401 LOGIN_REQUIRED   (thrown by resolveMerchantStoreId — P36 fix)
 *   2. Salla merchant WITH a valid session but NO row in `accounts`
 *        → 403 ACCOUNT_REQUIRED (this function; the dashboard shows the
 *          "complete your account" screen and posts to /api/auth/complete_account)
 *   3. Completed account (a row in `accounts` for this merchant)
 *        → passes, returns merchantId
 *
 * Read-only endpoints (store/overview, store/status, usage, store/bulk/status)
 * intentionally keep using resolveStoreId/resolveMerchantStoreId so the merchant
 * can still see their connected store before completing registration.
 *
 * Fail closed: if the account lookup itself errors (D1 down), we do NOT assume a
 * completed account — the merchant gets ACCOUNT_REQUIRED rather than free access.
 */
export async function requireCompletedAccount(request, env, claimedStoreId) {
  const merchantId = await resolveMerchantStoreId(request, env, claimedStoreId);

  const email = await getAccountEmail(env, merchantId).catch(() => null);
  if (!email) {
    throw new ApiError(
      403,
      "أكمل تسجيل حسابك عشان تقدر تستخدم هذي الميزة.",
      "ACCOUNT_REQUIRED"
    );
  }
  return merchantId;
}

/**
 * Admin gate: session token only carries merchantId (see resolveStoreId
 * above), never email — so this looks up the account's email in D1 and
 * checks it against ADMIN_EMAILS or DB is_admin.
 */
export async function requireAdmin(request, env) {
  const merchantId = await getSessionMerchantId(request, env);
  if (!merchantId) return null;

  let account = null;
  if (env?.DB) {
    account = await env.DB.prepare("SELECT email FROM accounts WHERE merchant_id = ?")
      .bind(merchantId)
      .first()
      .catch(() => null);
  }

  const email = account?.email || (await getAccountEmail(env, merchantId));
  if (!email) return null;

  const allow = (env?.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (allow.includes(email.toLowerCase())) {
    return { merchantId, email };
  }
  return null;
}


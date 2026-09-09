/* مجال إنستغرام (docs/INSTAGRAM_PLAN.md) — نُقل من core/db.js بالمرحلة ٣. */
// معالجة أحداث الويبهوك (المسودة + الطابور) نُقلت من `api/instagram/webhook.js`
// بالمرحلة ٤ بلا تغيير سلوكي — القيد الإلزامي **صفر نشر آلي** كما هو.
import { checkAndConsumeMonthly } from "../core/meter.js";
import { receive, refreshLongLivedToken } from "../integrations/instagram.js";
import { enqueue } from "./review.js";
import { logError } from "../core/errorLog.js";
import { askWorkersAI } from "../ai/gateway.js";
import { sanitizeInput } from "../core/security.js";
import { buildInstagramSystem } from "../ai/prompts/instagram.js";
import { stripFabricatedPricing } from "../ai/guards.js";


/**
 * توجيه الويبهوك الوارد: entry[].id (IG_ID) → التاجر المالك.
 * نظير getWaConnectionByPhoneId تماماً — وهو **المفتاح الوحيد** المسموح باستخدامه
 * لاختيار التاجر. لا from.id ولا username (كلاهما هوية المرسل، لا المستقبِل).
 */
export async function getIgConnectionByUserId(env, igUserId) {
  if (!env.DB || !igUserId) return null;
  // tenant-audit-ok: البحث بمفتاح التوجيه نفسه — هذا الاستعلام هو ما **يحدد**
  // merchant_id، فلا يمكن أن يشترط عليه. مطابق لنمط getWaConnectionByPhoneId.
  return env.DB.prepare(
    `SELECT merchant_id, ig_user_id, username, access_token, token_expires_at
     FROM ig_connections WHERE ig_user_id = ?`
  )
    .bind(String(igUserId))
    .first()
    .catch(() => null);
}

/**
 * إزالة تكرار أحداث إنستغرام.
 *
 * Meta تعيد المحاولة على مدى ٣٦ ساعة وتجمّع حتى ١٠٠٠ تحديث ⇒ التكرار **مضمون**.
 * INSERT ... ON CONFLICT DO NOTHING ذرّي: الصف الأول يكتب، والمكرر يُرفض بلا خطأ.
 * @returns {Promise<boolean>} true لو الحدث جديد (يُعالَج)، false لو مكرر (يُتجاهل).
 */
// المرحلة ٦: لم تعد مصدَّرة — كان الـshim `core/db.js` (المحذوف) يعيد تصديرها
// بلا مستورد واحد. تُستخدم داخل هذا الملف فقط؛ لا سطح تعديل زائف (لا كود ميت).
async function claimIgEvent(env, { eventId, merchantId, kind }) {
  if (!env.DB || !eventId || !merchantId) return false;
  const row = await env.DB.prepare(
    `INSERT INTO ig_processed_events (event_id, merchant_id, kind)
     VALUES (?, ?, ?)
     ON CONFLICT(event_id) DO NOTHING
     RETURNING event_id`
  )
    .bind(String(eventId), merchantId, kind)
    .first()
    .catch(() => null);
  return Boolean(row);
}

// نوافذ Meta الزمنية — تُخزَّن مع كل عنصر بالطابور ليعرف المراجع كم بقي له.
// Private Reply: ٧ أيام من التعليق، ومرة واحدة فقط لكل معلّق.
// رسالة مباشرة: ٢٤ ساعة من رسالة العميل. لا مبادرة إطلاقاً.
const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 3600 * 1000;
const DM_WINDOW_MS = 24 * 3600 * 1000;

/**
 * توليد مسودة رد. لا ترسل شيئاً — تعيد النص فقط.
 * [SKIP] من النموذج = سبام/إعلان منافس ⇒ لا يدخل الطابور إطلاقاً.
 */
export async function draftReply(env, { kind, text, merchantId, context, rid }) {
  const system = buildInstagramSystem(kind);

  // تعقيم قبل أي prompt (S7): نص التعليق مدخل غير موثوق من الإنترنت العام —
  // محاولة حقن أوامر عبره تُعامَل كهجوم، لا كرسالة.
  const clean = sanitizeInput(String(text || "").slice(0, 1000));
  if (!clean.trim()) return null;

  // storeId إلزامي: بدونه يعمل الاستدعاء بلا كاش عمداً (عزل المستأجرين) —
  // وتمريره يمنع أن يصل رد تاجر لتاجر آخر من الكاش المشترك.
  const reply = await askWorkersAI({
    env,
    system,
    messages: [{ role: "user", content: clean }],
    storeId: merchantId,
    maxTokens: 300,
    ttlKind: "chat"
  });

  const out = String(reply || "").trim();
  if (!out || out.includes("[SKIP]")) return null;

  // A1 — حارس الأسعار على إنستغرام. الخطر هنا **مضاعف**: التعليق العلني يبقى
  // تحت المنشور ويُقتبس بلقطة شاشة. شخصية أورا ممنوعة من أي رقم سعر (§٨)،
  // والمراجعة البشرية لاحقة — فالحارس آلي قبل الطابور لا بعده.
  const guard = stripFabricatedPricing(out);
  if (guard.stripped) {
    logError(context, {
      requestId: rid,
      path: "instagram/webhook:draft",
      code: "PRICE_STRIPPED",
      internal: `kind=${kind} — fabricated price removed from draft`,
      storeId: merchantId
    });
  }
  return guard.text.trim() || null;
}
export async function processIgEvents(context, events, rid) {
  const { env } = context;

  for (const event of events) {
    try {
      // 3) العزل: entry[].id → التاجر. لا مصدر آخر للهوية مقبول (المعيار أ.١).
      const conn = await getIgConnectionByUserId(env, event.igId);
      if (!conn) {
        // حساب غير مربوط عندنا — نتجاهل بصمت (قد يكون اشتراكاً قديماً).
        logError(context, {
          requestId: rid,
          path: "instagram/webhook",
          code: "IG_UNKNOWN_ACCOUNT",
          internal: "no ig_connections row for incoming entry id"
        });
        continue;
      }
      const merchantId = conn.merchant_id;

      // رسالة محذوفة: التزام تعاقدي بحذفها من طرفنا، لا معالجتها كرسالة.
      if (event.isDeleted) continue;
      if (!event.text) continue; // GIF/ملصق/مرفق بلا نص — لا مسودة تُبنى

      // 4) إزالة التكرار قبل استهلاك أي حصة — التكرار **مضمون** لا محتمل
      //    (إعادة محاولة Meta ٣٦ ساعة + دفعات حتى ١٠٠٠).
      const eventId = event.kind === "comment" ? event.commentId : event.mid;
      const isNew = await claimIgEvent(env, { eventId, merchantId, kind: event.kind });
      if (!isNew) continue;

      // 5) الحصة قبل نداء الذكاء (S5) — نفس مسار واتساب.
      const quota = await checkAndConsumeMonthly(env, merchantId, "message").catch((err) => {
        logError(context, {
          requestId: rid,
          path: "instagram/webhook:quota_check",
          code: "QUOTA_CHECK_FAILED",
          internal: err?.message,
          storeId: merchantId
        });
        return null;
      });
      // fail closed هنا عمداً — خلافاً لمسار واتساب: لا عميل ينتظر رداً فورياً
      // (كل شيء يمر بمراجعة بشرية أصلاً)، فتخطي الحصة بلا داعٍ يحرق رصيد التاجر.
      if (!quota || quota.ok === false) continue;

      // 6) المسودة
      const draft = await draftReply(env, {
        kind: event.kind,
        text: event.text,
        merchantId,
        context,
        rid
      });
      if (!draft) continue; // [SKIP] أو نص فارغ

      // 7) الطابور — نقطة النهاية الوحيدة. لا إرسال من هنا إطلاقاً.
      const now = Date.now();
      await enqueue(env, {
        merchantId,
        kind: "social_reply",
        payload: {
          channel: "instagram",
          mode: event.kind === "comment" ? "comment_reply" : "dm",
          igId: event.igId,
          commentId: event.commentId || null,
          recipientId: event.fromId || null,
          fromUsername: event.fromUsername || null,
          sourceText: event.text,
          draft,
          // المراجع يحتاج يعرف كم بقي قبل ما تُغلق النافذة — بدون هذا يوافق
          // على عنصر فات أوانه ويفشل الإرسال بلا سبب مفهوم (INSTAGRAM_PLAN §٢.٣).
          expiresAt: new Date(
            now + (event.kind === "comment" ? PRIVATE_REPLY_WINDOW_MS : DM_WINDOW_MS)
          ).toISOString()
        }
      });
    } catch (err) {
      logError(context, {
        requestId: rid,
        path: "instagram/webhook:process",
        code: "IG_EVENT_FAILED",
        internal: err?.message
      });
    }
  }
}

// ── المرحلة ٦ (ق٦): `api/**` لا يستورد `integrations/**` ────────────────────
/**
 * تحقق التوقيع على الجسم الخام ثم تفكيك الأحداث. نُقل من الويبهوك بلا تغيير
 * سلوكي — يرمي بنفس `err.status` (٤٠١ توقيع، ٤٠٠ حمولة) الذي تترجمه النقطة.
 */
export async function receiveIgEvents(rawBody, signatureHeader, env) {
  return receive(rawBody, signatureHeader, env);
}

// ── تجديد توكنات إنستغرام (INSTAGRAM_PLAN.md §٤.٢) ──────────────────────────
//
// توكن إنستغرام طويل الأمد يعيش **٦٠ يوماً**. بلا تجديد دوري: سقوط صامت بعد
// شهرين — نفس درس توكن واتساب المؤقت الذي أوقف البوت ٤٥ يوماً. يُستدعى من
// `api/cron/healthcheck.js` كل تِك (١٠ دقائق).
//
// ⚠️ Meta ترفض التجديد قبل مرور ٢٤ ساعة على إصدار التوكن. لا نحتاج شرطاً
// إضافياً: توكن يتبقى له أقل من ٧ أيام من أصل ٦٠ عمره ≥ ٥٣ يوماً بالضرورة.
//
// العتبة ٧ أيام والتِك كل ١٠ دقائق ⇒ آلاف الفرص قبل الانتهاء؛ فشل تِك واحد
// (شبكة، ٤٢٩) لا يُسقط شيئاً، ويُسجَّل ولا يوقف بقية الصفوف.

const IG_REFRESH_WINDOW_S = 7 * 24 * 3600;

/**
 * يجدّد كل توكن إنستغرام يتبقى له أقل من ٧ أيام.
 *
 * لا يلمس الشبكة إطلاقاً حين لا يوجد صف مستحق — الاستعلام يرشّح بـ
 * `token_expires_at` قبل أي `fetch`.
 *
 * @returns {Promise<{checked:number, refreshed:number, failed:number}>}
 */
export async function refreshExpiringIgTokens(env, context = null) {
  if (!env?.DB) return { checked: 0, refreshed: 0, failed: 0 };
  const cutoff = Math.floor(Date.now() / 1000) + IG_REFRESH_WINDOW_S;

  let rows = [];
  try {
    const res = await env.DB.prepare(
      `SELECT merchant_id, ig_user_id, access_token, token_expires_at
         FROM ig_connections WHERE token_expires_at < ?`
    )
      .bind(cutoff)
      .all();
    rows = res?.results || [];
  } catch (err) {
    logError(context, { requestId: null, path: "cron/ig_token_refresh", code: "IG_TOKEN_QUERY_FAILED", internal: String(err?.message || err).slice(0, 250) });
    return { checked: 0, refreshed: 0, failed: 0 };
  }

  let refreshed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const { accessToken, expiresIn } = await refreshLongLivedToken(row.access_token);
      await env.DB.prepare(
        `UPDATE ig_connections
            SET access_token = ?, token_expires_at = ?, updated_at = datetime('now')
          WHERE merchant_id = ? AND ig_user_id = ?`
      )
        .bind(accessToken, Math.floor(Date.now() / 1000) + expiresIn, row.merchant_id, row.ig_user_id)
        .run();
      refreshed++;
    } catch (err) {
      // فشل صف واحد لا يوقف البقية. بلا PII: لا توكن ولا اسم مستخدم بالسجل.
      failed++;
      logError(context, { requestId: null, path: "cron/ig_token_refresh", code: "IG_TOKEN_REFRESH_FAILED", storeId: row.merchant_id, internal: String(err?.message || err).slice(0, 250) });
    }
  }
  return { checked: rows.length, refreshed, failed };
}

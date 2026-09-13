// إلى أي صفّ تاجر يُربط متجر سلة القادم من تدفق OAuth اليدوي؟
//
// الخلل الذي أوجد هذا الملف (رُصد حياً 2026-09-10): `exchangeSallaCode` كان
// يبني الصفّ من **معرّف متجر سلة وحده**، ثم يُصدر `callback.js` جلسة جديدة
// لذاك الصفّ. فمن سجّل بالموقع ببريده ثم ضغط «اربط متجر سلة» يخرج بحسابين:
// حسابه ببريده وكلمة مروره **فاضٍ للأبد**، ومتجره بصفّ ثانٍ بلا بريد. يسجّل
// دخوله فيرى صفر منتجات بينما منتجاته مسحوبة فعلاً — تحت هوية أخرى.
//
// القاعدة الآن: **الجلسة تحكم.** التاجر المسجّل دخوله يربط المتجر بحسابه هو.
//
// وحين يكون المتجر مرتبطاً بصفّ آخر، **نرفض ونوضّح** ولا نفعل شيئاً ذكياً:
//   - لا دمج صامت: نقل بيانات بين حسابين فعلٌ لا رجعة فيه لا يُقرَّر عن التاجر.
//   - لا نقل ملكية: من يملك موافقة OAuth ليس بالضرورة صاحب الحساب — موظّف
//     بمتجر التاجر يقدر يوافق، فينقل بيانات متجر مخدومه لحسابه الشخصي.
//   - لا تبديل صامت للجلسة: هو بالضبط السلوك الذي أنتج الحسابين.
//
// المسار الأساسي (Easy Mode) لا يمرّ من هنا إطلاقاً: التثبيت من متجر تطبيقات
// سلة يصل كويبهوك موقَّع بلا جلسة، ويُفتح الداشبورد من داخل سلة عبر
// `auth/salla_embedded.js`. هذا الملف يخدم زر «اربط متجر سلة» باللوحة.
import { sanitizeInput } from "../core/security.js";

/** خطأ مصنَّف — نقطة النهاية تترجمه لرسالة عربية، ولا تُسرّب تفاصيل الصفّ الآخر. */
export class SallaLinkConflictError extends Error {
  constructor(reason) {
    super(`salla_link_conflict:${reason}`);
    this.name = "SallaLinkConflictError";
    // "claimed" = مرتبط بحساب له بريد · "orphan" = صفّ ويبهوك بلا حساب
    this.reason = reason;
  }
}

const CONFLICT_MESSAGES = {
  claimed:
    "هذا المتجر مرتبط مسبقاً بحساب آخر عندنا. سجّل دخولك بذاك الحساب، أو راسلنا على info@aura.sa وننقله لك بعد التحقق.",
  orphan:
    "هذا المتجر مربوط أصلاً عبر تثبيت التطبيق من سلة. افتح هالة من لوحة تحكم متجرك: تطبيقاتي ← هالة — وتلقى منتجاتك جاهزة."
};

export const linkConflictMessage = (reason) => CONFLICT_MESSAGES[reason] || CONFLICT_MESSAGES.claimed;

/**
 * يقرّر صفّ التاجر الذي تُحفظ فيه توكنات سلة، ويطبّق الربط على `merchants`.
 *
 * يرجّع `merchantId`، أو يرمي `SallaLinkConflictError` حين يكون المتجر
 * مرتبطاً بصفّ آخر. لا يلمس التوكنات — المستدعي يحفظها بالصفّ المُرجَع.
 */
export async function linkSallaToAccount(env, { sallaMerchantId, storeName, sessionMerchantId }) {
  const sallaId = String(sallaMerchantId);
  const name = storeName ? sanitizeInput(String(storeName), 100) : null;

  const existing = await env.DB.prepare("SELECT id FROM merchants WHERE salla_merchant_id = ?")
    .bind(sallaId)
    .first();

  // بلا جلسة: السلوك القديم كما هو — صفّ المتجر هو الهوية.
  if (!sessionMerchantId) {
    if (existing) {
      await touchName(env, existing.id, name);
      return existing.id;
    }
    return insertMerchant(env, sallaId, name);
  }

  // الجلسة تحكم: المتجر يُربط بحساب صاحب الجلسة.
  if (!existing) {
    await env.DB.prepare(
      `UPDATE merchants
          SET salla_merchant_id = ?,
              store_name = COALESCE(?, store_name),
              salla_disconnected_at = NULL
        WHERE id = ?`
    )
      .bind(sallaId, name, sessionMerchantId)
      .run();
    return sessionMerchantId;
  }

  if (existing.id === sessionMerchantId) {
    // إعادة ربط نفس المتجر بنفس الحساب — الحالة الطبيعية بعد فكّ ربط.
    await env.DB.prepare("UPDATE merchants SET salla_disconnected_at = NULL WHERE id = ?")
      .bind(sessionMerchantId)
      .run();
    await touchName(env, sessionMerchantId, name);
    return sessionMerchantId;
  }

  // مرتبط بصفّ آخر. نفرّق بين حالتين لأن الإرشاد يختلف تماماً.
  const claimed = await env.DB.prepare("SELECT 1 AS x FROM accounts WHERE merchant_id = ?")
    .bind(existing.id)
    .first()
    .catch(() => null);
  throw new SallaLinkConflictError(claimed ? "claimed" : "orphan");
}

async function touchName(env, merchantId, name) {
  if (!name) return;
  await env.DB.prepare("UPDATE merchants SET store_name = ? WHERE id = ?").bind(name, merchantId).run();
}

async function insertMerchant(env, sallaId, name) {
  const id = `m_${crypto.randomUUID().slice(0, 12)}`;
  await env.DB.prepare("INSERT INTO merchants (id, salla_merchant_id, store_name) VALUES (?, ?, ?)")
    .bind(id, sallaId, name)
    .run();
  return id;
}

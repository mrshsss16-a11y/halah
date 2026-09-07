// المرحلة ٣ (② PROFILE) من docs/PLAN_BULK_SEO.md — بصمة المتجر.
// الطبقة الوحيدة اللي تلمس جدول store_profiles (معيار M1، نفس منطق
// catalog.js وreviewQueue.js): شرط العزل (merchant_id) مفروض بمكان واحد لا
// يمكن نسيانه، وأي استدعاء بلا merchantId يرمي فوراً (fail closed).
//
// ── المشكلة التي يحلّها هذا الملف ───────────────────────────────────────────
// توليد أوصاف لـ٢٠٠ منتج بنفس الأسلوب يحتاج **مرساة ثابتة**. الطبقتان
// الموجودتان لا تكفيان:
//   • recallStyleExamples() — أمثلة حسب الفئة من مكتبة أدمن **عامة**، لا تعرف
//     هذا المتجر ولا جمهوره.
//   • recentCopy() — يجلب "الأخيرة" فقط، فعبر ٢٠٠ منتج **ينجرف**: منتج ٢٠٠
//     يقارن نفسه بمنتج ١٩٥ لا بمنتج ١، والأسلوب يمشي بعيداً بخطوات صغيرة.
// البصمة هي الطبقة الثالثة: **نفس النص حرفياً** يُحقن بالـ٢٠٠ استدعاء
// (الخطة §٥ الطبقة ١ — "المرساة").
//
// ── الحصة: استدعاء واحد، لا ٤٠ ──────────────────────────────────────────────
// buildProfile يقرأ عيّنة ≤٤٠ منتج ويستدعي النموذج **مرة واحدة** عليها كلها
// (منتجات العيّنة تُسرَد داخل رسالة واحدة). الخصم يتم عند نقطة الدخول
// functions/api/store/profile.js — انظر التعليل هناك لاختيار بكت `message`.
//
// ── بوابة المراجعة ─────────────────────────────────────────────────────────
// البصمة تُخزَّن بحالة `draft` وتُدرَج بـreview_queue (نوع `description`
// الموجود سلفاً — لا نوع جديد، `REVIEW_KINDS` بـCHECK constraint بـ0016 ولا
// يقبل ALTER على D1). **لا تُحقن بالتوليد قبل `approved`**: بصمة مخترعة من
// نموذج ثم مطبَّقة على ٢٠٠ منتج بلا موافقة إنسان = أوسع انتهاك ممكن لمبدأ
// "الـAI يقترح والإنسان يقرر".
import { ApiError } from "../core/respond.js";
import { askWorkersAI, TEXT_MODEL } from "../ai/gateway.js";
import { enqueue as enqueueReview, approve as approveReview } from "./reviewQueue.js";

const MAX_SAMPLE = 40;
const DEFAULT_SAMPLE = 40;

// سقوف كل حقل بالبصمة. سببها ليس التجميل: البصمة تُحقن **بكل** استدعاء توليد،
// فكل حرف زائد هنا يُضرب في ٢٠٠. بصمة منتفخة تزاحم الـgrounding الحقيقي
// (الوصف الحالي + ملاحظات الصورة) داخل نافذة السياق.
const LIMITS = {
  categories: { count: 8, chars: 60 },
  toneNotes: { count: 5, chars: 120 },
  vocabulary: { count: 15, chars: 40 },
  forbidden: { count: 10, chars: 60 },
  anchorKeywords: { count: 10, chars: 40 },
  audience: { chars: 300 }
};

function invalid(message, internal) {
  return new ApiError(400, message, "PROFILE_INVALID", internal);
}

function requireMerchantId(merchantId) {
  if (typeof merchantId !== "string" || !merchantId.trim()) {
    throw invalid("المتجر غير محدد.", "storeProfile: missing merchantId");
  }
  return merchantId.trim();
}

function requireDb(env) {
  if (!env?.DB) {
    throw new ApiError(503, "الخدمة غير متاحة حالياً.", "DB_UNAVAILABLE", "storeProfile: DB binding missing");
  }
  return env.DB;
}

function text(value, max) {
  if (value === null || value === undefined) return "";
  const s = String(value).replace(/\s+/g, " ").trim();
  return s.slice(0, max);
}

function stringList(value, { count, chars }) {
  const arr = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const item of arr) {
    const s = text(item, chars);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= count) break;
  }
  return out;
}

/**
 * الشكل القانوني للبصمة. أي مخرج نموذج (أو أي JSON يرسله التاجر بالتعديل)
 * يمرّ من هنا قبل التخزين — لا نثق بشكل مخرج النموذج ولا بمدخل العميل.
 * يرجّع دائماً الحقول الستة كلها (قوائم فارغة لا مفقودة) حتى يكون
 * profileToPromptBlock بلا فروع مفاجئة.
 */
export function normalizeProfile(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  return {
    categories: stringList(p.categories, LIMITS.categories),
    audience: text(p.audience, LIMITS.audience.chars),
    toneNotes: stringList(p.toneNotes, LIMITS.toneNotes),
    vocabulary: stringList(p.vocabulary, LIMITS.vocabulary),
    forbidden: stringList(p.forbidden, LIMITS.forbidden),
    anchorKeywords: stringList(p.anchorKeywords, LIMITS.anchorKeywords)
  };
}

function isEmptyProfile(p) {
  return (
    !p.audience &&
    !p.categories.length &&
    !p.toneNotes.length &&
    !p.vocabulary.length &&
    !p.forbidden.length &&
    !p.anchorKeywords.length
  );
}

/** يستخرج أول كائن JSON من رد النموذج (قد يجي داخل ```json أو بنص حوله). */
function parseProfileResponse(raw) {
  const source = typeof raw === "string" ? raw : String(raw ?? "");
  const md = source.match(/```json\s*([\s\S]*?)\s*```/);
  const candidate = md ? md[1] : (source.match(/\{[\s\S]*\}/) || [])[0];
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

const BUILD_SYSTEM = `أنتِ محللة هوية متاجر إلكترونية سعودية. تقرئين عيّنة من منتجات متجر واحد وتستخرجين "بصمة" المتجر: الملامح الثابتة التي تتكرر عبر منتجاته.

قواعد صارمة:
- استخرجي من العيّنة **فقط**. ممنوع اختراع فئة أو جمهور أو مفردة غير ظاهرة بالبيانات.
- ممنوع ذكر أي رقم سعر بالبصمة.
- "vocabulary" = كلمات ومصطلحات يستعملها المتجر فعلاً بأوصافه (لا كلمات عامة مثل "جودة").
- "forbidden" = أساليب أو تعابير **لا** تناسب هذا المتجر بناءً على نبرته الظاهرة (مثل "مبالغة إعلانية" لمتجر طبي).
- "toneNotes" = ملاحظات قصيرة عن النبرة والبنية والطول السائد بالأوصاف الحالية.
- عربي فصيح مختصر. لا جمل طويلة.

أرجعي **JSON فقط** بلا أي نص خارجه:
{
  "categories": ["<فئة>", "..."],
  "audience": "<وصف الجمهور بجملة أو جملتين>",
  "toneNotes": ["<ملاحظة نبرة>", "..."],
  "vocabulary": ["<مفردة>", "..."],
  "forbidden": ["<ممنوع>", "..."],
  "anchorKeywords": ["<كلمة مفتاحية تتكرر عبر المتجر>", "..."]
}`;

function sampleToUserMessage(rows) {
  const lines = rows.map((r, i) => {
    const parts = [`${i + 1}. ${r.name}`];
    if (r.category) parts.push(`الفئة: ${r.category}`);
    const desc = text(r.current_description, 400);
    if (desc) parts.push(`الوصف الحالي: ${desc}`);
    return parts.join(" | ");
  });
  return `عيّنة من منتجات المتجر (${rows.length} منتج):\n${lines.join("\n")}`;
}

/**
 * يبني بصمة المتجر من عيّنة من store_products — **استدعاء AI واحد**.
 *
 * `ask` منفذ حقن للاختبار فقط (الافتراضي askWorkersAI الحقيقية): يسمح بإثبات
 * "استدعاء واحد لا ٤٠" بعدّ الاستدعاءات، بلا شبكة ولا توكنات.
 *
 * يخزّن النتيجة بحالة `draft` ويُدرجها ببوابة المراجعة. **لا يعتمدها.**
 *
 * @returns {Promise<{profile:object, status:'draft', sampleSize:number, reviewId:number|null, aiCalls:number}>}
 */
export async function buildProfile(env, { merchantId, sampleSize = DEFAULT_SAMPLE, ask = askWorkersAI } = {}) {
  const mid = requireMerchantId(merchantId);
  const db = requireDb(env);
  const size = Math.min(MAX_SAMPLE, Math.max(1, Math.floor(Number(sampleSize) || DEFAULT_SAMPLE)));

  // العيّنة: أحدث المنتجات المسحوبة لهذا التاجر وحده. الأوصاف الموجودة أولاً
  // (current_description غير فارغ) لأنها المصدر الحقيقي الوحيد للنبرة —
  // منتج بلا وصف لا يعلّم البصمة شيئاً عن الأسلوب.
  const { results } = await db
    .prepare(
      `SELECT name, category, current_description
         FROM store_products
        WHERE merchant_id = ?
        ORDER BY (current_description IS NULL OR current_description = '') ASC,
                 synced_at DESC, sku ASC
        LIMIT ?`
    )
    .bind(mid, size)
    .all();

  const rows = results || [];
  if (!rows.length) {
    throw invalid(
      "ما فيه منتجات مسحوبة لمتجرك بعد — اسحب الكتالوج أولاً ثم ابنِ بصمة المتجر.",
      "storeProfile: empty catalog sample"
    );
  }

  const raw = await ask({
    env,
    system: BUILD_SYSTEM,
    messages: [{ role: "user", content: sampleToUserMessage(rows) }],
    maxTokens: 900,
    model: TEXT_MODEL,
    storeId: mid // يعزل كاش KV — بصمة متجر لا تُسلَّم لمتجر ثانٍ
  });

  const profile = normalizeProfile(parseProfileResponse(raw));
  if (isEmptyProfile(profile)) {
    throw new ApiError(
      502,
      "تعذّر بناء بصمة متجرك الحين. حاول بعد شوي.",
      "PROFILE_BUILD_FAILED",
      "storeProfile: model returned unusable profile"
    );
  }

  // العزل: merchant_id هو المفتاح الأساسي، فالكتابة لا تقدر تلمس صف تاجر ثانٍ.
  // إعادة البناء ترجّع الحالة لـ`draft` عمداً: بصمة جديدة لم يرها أحد يجب ألا
  // ترث موافقة بصمة قديمة.
  await db
    .prepare(
      `INSERT INTO store_profiles (merchant_id, profile, status, source_sample, updated_at)
       VALUES (?, ?, 'draft', ?, datetime('now'))
       ON CONFLICT(merchant_id) DO UPDATE SET
         profile = excluded.profile,
         status = 'draft',
         source_sample = excluded.source_sample,
         updated_at = datetime('now')`
    )
    .bind(mid, JSON.stringify(profile), rows.length)
    .run();

  // بوابة المراجعة البشرية. فشل الإدراج لا يجوز يخفي البصمة عن التاجر (هي
  // مخزّنة draft أصلاً ولن تُحقن بلا اعتماد)، لكنه يُبلَّغ بـreviewId=null.
  let reviewId = null;
  try {
    const row = await enqueueReview(env, {
      merchantId: mid,
      kind: "description",
      payload: { type: "store_profile", profile, sampleSize: rows.length }
    });
    reviewId = row?.id ?? null;
  } catch {
    reviewId = null;
  }

  return { profile, status: "draft", sampleSize: rows.length, reviewId, aiCalls: 1 };
}

/**
 * بصمة تاجر واحد. **لا يرمي لو ما فيه بصمة** — الغياب حالة طبيعية تماماً
 * (متجر ما بنى بصمته بعد)، والمستدعي بـcopy.js يكمل بالسلوك القديم.
 *
 * @returns {Promise<{profile:object|null, status:string|null, sampleSize:number, updatedAt:string|null}>}
 */
export async function getProfile(env, { merchantId } = {}) {
  const mid = requireMerchantId(merchantId);
  const db = requireDb(env);

  const row = await db
    .prepare(
      "SELECT profile, status, source_sample, updated_at FROM store_profiles WHERE merchant_id = ?"
    )
    .bind(mid)
    .first();

  if (!row) return { profile: null, status: null, sampleSize: 0, updatedAt: null };

  let parsed = null;
  try {
    parsed = normalizeProfile(JSON.parse(row.profile));
  } catch {
    // صف تالف: نعامله كغياب بصمة بدل كسر التوليد. لا حقن ⇒ السلوك القديم.
    return { profile: null, status: null, sampleSize: 0, updatedAt: row.updated_at ?? null };
  }

  return {
    profile: parsed,
    status: row.status || null,
    sampleSize: Number(row.source_sample || 0),
    updatedAt: row.updated_at ?? null
  };
}

/**
 * اعتماد البصمة — القرار البشري الذي يفتح الحقن بمحرّك التوليد.
 *
 * `profile` اختياري: لو مرَّره التاجر فهو نسخته المعدّلة (يمرّ بـnormalizeProfile
 * مثل مخرج النموذج تماماً — لا نثق بمدخل العميل)، وإلا نعتمد المخزَّن كما هو.
 * `reviewId` اختياري: لو مرَّر، نغلق صف الطابور المقابل عبر reviewQueue نفسها
 * (لا SQL على review_queue من هنا — طبقة واحدة تملك ذاك الجدول).
 */
export async function approveProfile(env, { merchantId, profile = null, reviewId = null, reviewedBy = null } = {}) {
  const mid = requireMerchantId(merchantId);
  const db = requireDb(env);

  const existing = await getProfile(env, { merchantId: mid });
  if (!existing.profile && !profile) {
    throw invalid("ما فيه بصمة لمتجرك — ابنِ البصمة أولاً.", "storeProfile: approve without profile");
  }

  const next = profile ? normalizeProfile(profile) : existing.profile;
  if (isEmptyProfile(next)) {
    throw invalid("البصمة فارغة — ما فيه شيء يُعتمد.", "storeProfile: approve empty profile");
  }

  const row = await db
    .prepare(
      `UPDATE store_profiles
          SET profile = ?, status = 'approved', updated_at = datetime('now')
        WHERE merchant_id = ?
        RETURNING merchant_id, status, source_sample, updated_at`
    )
    .bind(JSON.stringify(next), mid)
    .first();

  if (!row) {
    throw invalid("ما فيه بصمة لمتجرك — ابنِ البصمة أولاً.", "storeProfile: no row to approve");
  }

  if (reviewId !== null && reviewedBy) {
    // فشل إغلاق صف الطابور (مُراجَع مسبقاً مثلاً) لا يلغي اعتماد البصمة نفسه.
    await approveReview(env, { merchantId: mid, id: reviewId, reviewedBy }).catch(() => {});
  }

  return { profile: next, status: "approved", sampleSize: Number(row.source_sample || 0), updatedAt: row.updated_at ?? null };
}

/**
 * يحوّل البصمة لكتلة نص عربي صالحة للحقن بالـsystem prompt.
 *
 * **نفس النص حرفياً لكل منتجات المتجر** — هذي هي المرساة. لا عشوائية ولا
 * ترتيب متغيّر ولا اقتطاع حسب المنتج، وإلا انهار الغرض.
 *
 * يرجّع "" لو ما فيه بصمة صالحة، فالمستدعي يقدر يجمعها بلا شرط إضافي.
 */
export function profileToPromptBlock(profile) {
  if (!profile || typeof profile !== "object") return "";
  const p = normalizeProfile(profile);
  if (isEmptyProfile(p)) return "";

  const lines = [];
  if (p.categories.length) lines.push(`- فئات المتجر: ${p.categories.join("، ")}`);
  if (p.audience) lines.push(`- جمهور المتجر: ${p.audience}`);
  if (p.toneNotes.length) lines.push(`- نبرة المتجر: ${p.toneNotes.join(" · ")}`);
  if (p.vocabulary.length) lines.push(`- مفردات يستعملها المتجر فعلاً (وظّفيها بطبيعية، لا حشواً): ${p.vocabulary.join("، ")}`);
  if (p.anchorKeywords.length) lines.push(`- كلمات مرساة تتكرر عبر المتجر: ${p.anchorKeywords.join("، ")}`);
  if (p.forbidden.length) lines.push(`- ممنوعات هذا المتجر (لا تستخدميها إطلاقاً): ${p.forbidden.join("، ")}`);

  return `## بصمة هذا المتجر (معتمَدة من التاجر — الأسلوب الثابت لكل منتجاته)
${lines.join("\n")}

هذي البصمة تصف **المتجر** لا هذا المنتج: استخدميها لتثبيت الأسلوب والنبرة والمفردات عبر كل المنتجات، وممنوع اشتقاق أي مواصفة أو حقيقة عن المنتج الحالي منها.`;
}

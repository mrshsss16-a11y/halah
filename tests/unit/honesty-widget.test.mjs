// صدق ودجت الموقع (2026-09-10): البرومبت الحي كان يبيع منتجاً قديماً — فحص ٣٠ ثانية
// (مؤرشف)، Trendyol وزد (مؤرشفان)، استرداد سلات (مؤرشف)، تجربة ٣٠ يوم بـ٢٠٠ وصف
// و٤٠٠ صورة (الحقيقة: ٦٠/٣٠٠/٢٠ شهرياً). هذا الملف يمنع عودة أي ادعاء منها،
// ويثبت أن ذاكرة RAG تتبع الجدول لا العكس.
import { createRunner } from "../_helpers.mjs";
import { HALA_SUPPORT_PROMPT } from "../../functions/_lib/ai/persona.js";
import { MONTHLY_BUCKET_LIMITS } from "../../functions/_lib/core/meter.js";
import { syncHalaFaqEmbeddings, faqFingerprint } from "../../functions/_lib/domain/faqSync.js";
import { sendAdminAlert } from "../../functions/_lib/domain/health.js";

const { assert, done } = createRunner("honesty-widget");

// ── البرومبت الحي لا يعد بميزة مؤرشفة ولا برقم غير حقيقي ──────────────────
const banned = [
  ["٣٠ ثانية", "فحص ٣٠ ثانية"],
  ["30 ثانية", "فحص 30 ثانية"],
  ["فحص المتجر بالذكاء", "فحص المتجر"],
  ["Trendyol", "Trendyol"],
  ["قريباً زد", "زد قريباً"],
  ["يسترد السلات", "استرداد السلات"],
  ["٣٠ يوم", "تجربة ٣٠ يوم"],
  ["٢٠٠ وصف", "٢٠٠ وصف"],
  ["٤٠٠ صورة", "٤٠٠ صورة"],
  ["٥٠ رسالة", "٥٠ رسالة"]
];
for (const [needle, label] of banned) {
  assert(!HALA_SUPPORT_PROMPT.includes(needle), `HON-1: برومبت الودجت بلا ادعاء "${label}" (ميزة مؤرشفة أو رقم قديم)`);
}
const toArabicDigits = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
assert(
  HALA_SUPPORT_PROMPT.includes(`${toArabicDigits(MONTHLY_BUCKET_LIMITS.description)} وصف`) &&
    HALA_SUPPORT_PROMPT.includes(`${toArabicDigits(MONTHLY_BUCKET_LIMITS.message)} رسالة`) &&
    HALA_SUPPORT_PROMPT.includes(`${toArabicDigits(MONTHLY_BUCKET_LIMITS.image)} صورة`),
  "HON-2: أرقام الباقة المجانية بالبرومبت = حدود meter.js الفعلية (٦٠/٣٠٠/٢٠)"
);
assert(/سلة فقط/.test(HALA_SUPPORT_PROMPT) && /قيد الاعتماد من ميتا/.test(HALA_SUPPORT_PROMPT), "HON-3: المنصة سلة فقط، وربط واتساب التاجر موصوف كقيد اعتماد لا كميزة قائمة");
assert(/ممنوع تمنعاً باتاً/.test(HALA_SUPPORT_PROMPT) && /\[WHATSAPP_CTA\]/.test(HALA_SUPPORT_PROMPT), "HON-4: قاعدة منع الأسعار وCTA الواتساب باقيتان");

// ── مزامنة RAG: تعديل الجدول يُعاد تضمينه، وبلا تغيير صفر نداء ───────────
{
  const rows = [
    { id: 1, question: "س١", answer: "ج١" },
    { id: 2, question: "س٢", answer: "ج٢" }
  ];
  const kv = new Map();
  const env = {
    DB: { prepare: () => ({ all: async () => ({ results: rows }) }) },
    VECTORIZE_INDEX: {},
    HALA_CACHE: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } }
  };
  const calls = { reembed: 0, removed: [] };
  const reembed = async (_env, r) => { calls.reembed++; return r.length; };
  const remove = async (_env, id) => { calls.removed.push(id); };

  const first = await syncHalaFaqEmbeddings(env, { reembed, remove });
  assert(first.changed && first.reembedded === 2 && calls.reembed === 1, "HON-5: أول مزامنة تُضمّن كل الصفوف");
  const second = await syncHalaFaqEmbeddings(env, { reembed, remove });
  assert(!second.changed && calls.reembed === 1, "HON-6: بلا تغيير = صفر نداء تضمين (البصمة بـKV)");
  rows[0].answer = "ج١ معدَّل";
  const third = await syncHalaFaqEmbeddings(env, { reembed, remove });
  assert(third.changed && calls.reembed === 2, "HON-7: تعديل إجابة واحدة يُعيد التضمين بالتِك التالي");
  rows.pop();
  const fourth = await syncHalaFaqEmbeddings(env, { reembed, remove });
  assert(fourth.changed && fourth.deleted === 1 && calls.removed[0] === 2, "HON-8: صف محذوف من الجدول يُحذف متجهه أيضاً");
  assert((await faqFingerprint([{ id: 1, question: "a", answer: "b" }])) !== (await faqFingerprint([{ id: 1, question: "a", answer: "c" }])), "HON-9: البصمة تتغير بتغير الإجابة");
  const noBindings = await syncHalaFaqEmbeddings({ DB: env.DB }, { reembed, remove });
  assert(noBindings.skipped === "bindings" && calls.reembed === 3, "HON-10: بلا Vectorize = تخطٍّ صريح لا ادعاء مزامنة");
}

// ── تنبيه الأدمن بلا رقم افتراضي مكتوب ─────────────────────────────────────
{
  let sent = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { sent++; return new Response("{}", { status: 200 }); };
  const env = { WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_ID: "p", HALA_CACHE: { get: async () => null, put: async () => {} } };
  await sendAdminAlert(env, "test_alert", "x");
  globalThis.fetch = realFetch;
  assert(sent === 0, "HON-11: بلا STORE_WA_PHONE لا يُرسَل تنبيه لأي رقم مكتوب بالكود");
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../../functions/_lib/domain/health.js", import.meta.url), "utf8"));
  assert(!/9665\d{8}/.test(src), "HON-12: صفر رقم جوال حرفي بـdomain/health.js");
}

done();

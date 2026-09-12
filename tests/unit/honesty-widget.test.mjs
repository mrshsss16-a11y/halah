// صدق ودجت الموقع (2026-09-10): البرومبت الحي كان يبيع منتجاً قديماً — فحص ٣٠ ثانية
// (مؤرشف)، Trendyol وزد (مؤرشفان)، استرداد سلات (مؤرشف)، تجربة ٣٠ يوم بـ٢٠٠ وصف
// و٤٠٠ صورة (الحقيقة: ٦٠/٣٠٠/٢٠ شهرياً). هذا الملف يمنع عودة أي ادعاء منها،
// ويثبت أن ذاكرة RAG تتبع الجدول لا العكس.
import { createRunner } from "../_helpers.mjs";
import { HALA_SUPPORT_PROMPT } from "../../functions/_lib/ai/persona.js";
import { MONTHLY_BUCKET_LIMITS, DAILY_BUCKET_LIMITS } from "../../functions/_lib/core/meter.js";
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
// HON-2 عُدّل 2026-09-10: كان يطلب ذكر الدلاء الثلاثة (٦٠/٣٠٠/٢٠). لكن دلو
// message بلا سطح صرف للتاجر منذ إزالة تبويب الوكيل، ودلو image يُستهلك بتوليد
// الصور من الأدمن فقط — فذكرهما للزائر وعدٌ بما لا يُستعمل. الحارس الآن: رقم
// الأوصاف مطابق لـmeter.js، ورقما الرسائل والصور **غائبان**.
assert(
  HALA_SUPPORT_PROMPT.includes(`${toArabicDigits(DAILY_BUCKET_LIMITS.description)} أوصاف منتجات** يومياً`) &&
    !HALA_SUPPORT_PROMPT.includes(`${toArabicDigits(MONTHLY_BUCKET_LIMITS.message)} رسالة`) &&
    !HALA_SUPPORT_PROMPT.includes(`${toArabicDigits(MONTHLY_BUCKET_LIMITS.image)} صورة`),
  "HON-2: البرومبت يذكر حد الأوصاف اليومي الحقيقي (meter.js) ولا يعد بحصة رسائل أو صور لا يصرفها التاجر"
);
assert(
  /سلة فقط/.test(HALA_SUPPORT_PROMPT) && /واتساب التاجر: \*\*غير\s+متوفرة للتجار حالياً/.test(HALA_SUPPORT_PROMPT),
  "HON-3: المنصة سلة فقط، وربط واتساب التاجر ضمن قائمة «غير متوفرة حالياً» لا كميزة قائمة"
);
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

// ── حارس الميزات المؤرشفة: حتمي، لا يجامل ──────────────────────────────────
{
  const { stripArchivedClaims } = await import("../../functions/_lib/ai/guards.js");
  const cases = [
    ["أكيد، تقدر تحجز فحص مجاني للمتجر مع فريق أورا.", "scan"],
    ["أكيد، تقدر تحجز فحص لمتجرك، قولي الوقت المناسب.", "scan"],
    ["نعم، نقدر نساعد في استرجاع السلات المتروكة.", "cart"],
    ["نعم، هالة يتكامل مع سلة وتريندول، ودعم منصة زد قادم قريباً.", "platform"],
    ["تجربة مجانية ٣٠ يوم بدون بطاقة.", "trial"]
  ];
  for (const [text, topic] of cases) {
    const r = stripArchivedClaims(text);
    assert(r.stripped && r.topic === topic && !/فحص مجاني|تريندول|٣٠ يوم مجان/.test(r.text) && r.text.length > 20, `HON-13: مجاملة "${topic}" تُستبدل برد صادق حتمي`);
  }
  for (const ok of [
    "هالة تعمل مع متاجر سلة فقط حالياً.",
    "الباقة المجانية: ٥ أوصاف منتجات يومياً.",
    "تقدر تحجز استشارة مجانية مع فريق أورا من صفحة الاستشارة."
  ]) {
    assert(!stripArchivedClaims(ok).stripped, `HON-14: رد صادق لا يُمسّ: "${ok.slice(0, 30)}"`);
  }
  // HON-16 (2026-09-10): باقة سلة فيها فترة تجربة، فالرد الحتمي لا يجوز أن ينفيها —
  // كان يقول «ما فيه تجربة محدودة بعدد أيام»، أي أن الحارس يستبدل الصدق بادعاء.
  {
    const trialReply = stripArchivedClaims("تجربة مجانية ٣٠ يوم بدون بطاقة.").text;
    assert(
      !/ما فيه تجربة/.test(trialReply) && /سلة/.test(trialReply) && !/\d|[٠-٩]+\s*يوم/.test(trialReply.replace(/٥/g, "")),
      "HON-16: رد التجربة الحتمي لا ينفي تجربة سلة ولا يثبّت عدد أيام"
    );
    assert(
      !/ما فيه تجربة محدودة/.test(HALA_SUPPORT_PROMPT) && /التثبيت من متجر تطبيقات سلة/.test(HALA_SUPPORT_PROMPT),
      "HON-16b: البرومبت يفرّق التسجيل المباشر عن التثبيت من سلة"
    );
  }
  const supportSrc = await import("node:fs").then((fs) => fs.readFileSync(new URL("../../functions/_lib/domain/support.js", import.meta.url), "utf8"));
  assert(/if \(isAuraLine\) \{\s*\n\s*const archived = stripArchivedClaims\(reply\)/.test(supportSrc) && /ARCHIVED_CLAIM_STRIPPED/.test(supportSrc), "HON-15: الحارس مطبَّق على خط هالة فقط بعد التوليد ويُسجَّل بلا نص");
}

// ── HON-17: صفحة الأسئلة الشائعة مرتبطة بملف تقديم سلة — لا وعد بحصة لا تُصرف ──
// (2026-09-10) كانت تسرد «٣٠٠ رسالة مساعد» و«٢٠ صورة» بوسوم <strong> فأفلتت من
// فحص نصي بسيط. يُفحص النص الظاهر بعد تجريد الوسوم والتعليقات.
{
  const fs = await import("node:fs");
  const faq = fs.readFileSync(new URL("../../faq.html", import.meta.url), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ");
  assert(new RegExp(`${toArabicDigits(DAILY_BUCKET_LIMITS.description)} أوصاف منتجات`).test(faq) && /يومياً/.test(faq), "HON-17a: الأسئلة الشائعة تذكر حد الأوصاف اليومي الحقيقي");
  assert(!/٣٠٠ رسالة|رسالة مساعد/.test(faq), "HON-17b: لا حصة رسائل مساعد بالأسئلة الشائعة");
  assert(!/٢٠ صورة/.test(faq), "HON-17c: لا حصة صور منفصلة بالأسئلة الشائعة");
}

done();

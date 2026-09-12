// المرحلة ٠ من خطة المراجعة (2026-09-11): حاجب تقديم سلة.
//
// تحرس أن الوثائق العامة تصف المنتج المقدَّم فعلاً وأن الكود يطابقها — لا العكس.
// المراجعة الشاملة وجدت أن `faq.html` تقول «لا نقرأ طلباتك» بينما `storeOverview`
// كان يجلب الطلبات بأسماء العملاء. القرار: إزالة القراءة (المنتج أوصاف فقط).
import { readFileSync } from "node:fs";
import { createRunner } from "../_helpers.mjs";

const { assert, done } = createRunner("phase0-submission");
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const visible = (html) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/<style\b[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

async function main() {
  // ── الكود لا يقرأ طلبات ولا عملاء ──────────────────────────────────────
  {
    const overview = read("../../functions/_lib/domain/storeOverview.js");
    const salla = read("../../functions/_lib/integrations/salla.js");
    const platforms = read("../../functions/_lib/domain/platforms.js");
    const storeJs = read("../../public/js/dashboard/store.js");
    const partial = read("../../partials/dashboard-store.html");
    assert(!/listOrders|abandonedCarts|customerPhone|customerName/.test(overview), "P0-1: نظرة المتجر منتجات فقط — لا طلبات ولا عملاء");
    assert(!/export async function listOrders/.test(salla), "P0-2: محوّل سلة بلا قارئ طلبات — ما لا نطلبه لا نقرؤه");
    assert(!/listAbandonedCarts|listSyncedProducts/.test(platforms), "P0-3: لا قوائم سلات متروكة أو منتجات منصات أخرى");
    assert(!/orderList|آخر الطلبات/.test(visible(partial)) && !/orderList/.test(storeJs), "P0-4: تبويب «متجري» بلا قسم طلبات");
  }

  // ── الوثائق العامة تصف المنتج الفعلي ─────────────────────────────────
  {
    const privacy = visible(read("../../privacy.html"));
    const terms = visible(read("../../terms.html"));
    const faq = visible(read("../../faq.html"));
    for (const [name, txt] of [["privacy", privacy], ["terms", terms]]) {
      assert(/صور(ة)? (ال)?منتج/.test(txt) && /تحل(ي|ّ)ل/.test(txt), `P0-5/${name}: تذكر تحليل صور المنتجات — وظيفة التطبيق المعلَنة`);
      assert(!/مساعدة خدمة عملاء|رد آلي|ودجت المحادثة/.test(txt), `P0-6/${name}: لا وصف لمنتج مخفي (رد آلي/ودجت)`);
      assert(/لا نقرأ طلباتك|لا نقرأ طلباتك ولا بيانات عملائك/.test(txt), `P0-7/${name}: تصرّح أننا لا نقرأ الطلبات — والكود يطابق (P0-1)`);
    }
    // مزوّدو المعالجة: كل مزوّد نص يستدعيه gateway.js يُسمّى بصفحة الخصوصية.
    const gateway = read("../../functions/_lib/ai/gateway.js");
    for (const [host, name] of [["api.groq.com", "Groq"], ["openrouter.ai", "OpenRouter"]]) {
      if (gateway.includes(host)) assert(privacy.includes(name), `P0-8: الخصوصية تسمّي ${name} — مزوّد نص فعلي بالكود`);
    }
    // DeepSeek أُخرج قبل تقديم سلة (2026-09-11): سياسته المعلنة تخزّن البيانات في الصين،
    // وصفحة الخصوصية لم تكن تذكر ذلك. لا عودة صامتة: لا نداء بالكود ولا سطر بالخصوصية.
    assert(!/api\.deepseek\.com|DEEPSEEK_API_KEY|askDeepSeek/.test(gateway), "P0-8b: لا طبقة DeepSeek بسلسلة الذكاء الاصطناعي");
    assert(!/DeepSeek/.test(privacy), "P0-8c: الخصوصية لا تسمّي مزوّداً لا نستخدمه");
    // قرار المالك 2026-09-12: الرؤية تسقط لـGroq ثم OpenRouter عند تعذّر Cloudflare — الخصوصية تقول ذلك.
    const vision = read("../../functions/_lib/ai/vision.js");
    assert(/Cloudflare أولاً/.test(privacy) && !/لا تغادرها/.test(privacy), "P0-9: الخصوصية لا تعد بأن الصورة لا تغادر Cloudflare — الرؤية لها احتياط خارجي");
    for (const [host, name] of [["api.groq.com", "Groq"], ["openrouter.ai", "OpenRouter"]]) {
      if (vision.includes(host)) assert(new RegExp(`${name}[\\s\\S]{0,160}صورة المنتج`).test(read("../../privacy.html").replace(/\s+/g, " ")), `P0-9b: الخصوصية تذكر إرسال الصورة إلى ${name} — مزوّد رؤية فعلي بالكود`);
    }
    assert(/نظام حماية البيانات الشخصية/.test(privacy) && /تصحيح/.test(privacy) && /سحب موافقتك/.test(privacy) && /شكوى/.test(privacy), "P0-10: حقوق PDPL: الاطلاع والتصحيح والحذف وسحب الموافقة والشكوى");
    assert(/مدة الاحتفاظ/.test(privacy) && /لا تُخزَّن/.test(privacy), "P0-11: جدول مدد احتفاظ، والصورة لا تُخزَّن");
    assert(!/ليست شهادة امتثال/.test(privacy), "P0-12: لا فقرة تُقرأ كإقرار بعدم الامتثال");
    assert(/٦٠/.test(faq) && !/٣٠٠|٢٠ صورة/.test(faq), "P0-13: الأسئلة الشائعة على الحصة الحقيقية فقط");
  }

  // ── ثغرات صغيرة سُدّت ──────────────────────────────────────────────────
  {
    const session = read("../../functions/_lib/core/session.js");
    assert(/SameSite=None; Partitioned; Max-Age/.test(session), "P0-14: كوكي الجلسة Partitioned — لا يسقط داخل إطار سلة عند تقسيم كوكيز الطرف الثالث");
    const emb = read("../../functions/api/auth/salla_embedded.js");
    assert(/"salla_embedded_auth", 20, 60, \{ failClosed: true \}/.test(emb), "P0-15: حد معدل salla_embedded fail-closed كبقية المصادقة");
    const review = read("../../public/js/dashboard/review.js");
    assert(/data\?\.ok \? "success" : "error"\);\s*\n\s*loadReview\("published"\)/.test(review), "P0-16: نجاح التراجع يُعرض كنجاح لا كخطأ");
    const storeJs = read("../../public/js/dashboard/store.js");
    assert(/errBox\.innerText = msg;\s*\n\s*errBox\.classList\.remove\("hidden"\);\s*\n\s*return;/.test(storeJs), "P0-17: فشل نظرة المتجر يظهر داخل التبويب لا بالشريط وحده");
    const pkg = JSON.parse(read("../../package.json"));
    assert(/^npm test && /.test(pkg.scripts.deploy), "P0-18: النشر لا يمر بلا npm test");
  }
}

main().then(done);

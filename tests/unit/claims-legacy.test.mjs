// ادعاءات من حزمة السياسات القديمة المنقّحة (halah-rag-dev، 2026-09-12) + فحوص SEO.
import { createRunner } from "../_helpers.mjs";
import { unsourcedClaims } from "../../functions/_lib/domain/copyClaims.js";
import { polishPage } from "../../functions/_lib/domain/copyPage.js";

const { assert, done } = createRunner("claims-legacy");

async function main() {
  const cases = [
    ["عسل سدر يعالج الكحة ويقوي المناعة.", "THERAPEUTIC"],
    ["زعفران صنع في إيران بجودة الموسم.", "ORIGIN"],
    ["عباية متوفرة بالتقسيط عبر تمارا وتابي.", "PAYMENT_METHODS"],
    ["فستان قابل للإرجاع خلال أسبوع.", "RETURNS_POLICY"],
    ["بياناتك محمية بالكامل عند الطلب.", "DATA_PROTECTION"],
    ["أفضل عطر عود في السوق ورقم 1 بالمملكة.", "SUPERLATIVE"],
    ["ساعة ووتر بروف للاستخدام اليومي.", "WATER_RESISTANCE"],
    ["شنطة أورجينال مو تقليد.", "AUTHENTIC"],
    ["كريم بدون مواد حافظة.", "NATURAL"],
    ["آخر قطعة بالمخزون.", "SCARCITY"]
  ];
  const misses = cases.filter(([t, code]) => !unsourcedClaims(t, "").includes(code)).map(([t, code]) => `${code}:${t}`);
  assert(misses.length === 0, `CL2-1: عائلات الادعاء الجديدة من حزمة السياسات تُرصد (${misses.join(" | ")})`);
  assert(!unsourcedClaims("زعفران نقي", "زعفران صنع في إيران").includes("ORIGIN") && !unsourcedClaims("يدعم الدفع عند الاستلام", "الدفع عند الاستلام متاح").includes("PAYMENT_METHODS"), "CL2-2: الادعاء مسموح حين ذكره التاجر");
  const neutral = ["الخصر الطبيعي عند أضيق نقطة.", "صورة بإضاءة طبيعية تُظهر اللون.", "قماش ينسدل بشكل طبيعي."];
  assert(neutral.every((t) => !unsourcedClaims(t, "").includes("NATURAL")) && unsourcedClaims("زيت طبيعي للشعر.", "").includes("NATURAL"), "CL2-3: «الخصر الطبيعي» و«إضاءة طبيعية» ليست ادعاءً، و«زيت طبيعي» ادعاء");
  {
    const p = polishPage({ seo: { title: "عباية سوداء", seoTitle: "عباية سوداء", metaDescription: "عباية سوداء بكم واسع." }, copywriting: { description: "عباية سوداء بكم واسع.", excerpt: "عباية سوداء.", whatsapp: "", highlights: [] }, faqs: [], tags: ["عباية سوداء", "عبايه سوداء", "عباية  سوداء", "عبايات يومية"] }, { name: "عباية سوداء", category: "عبايات" });
    assert(p.tags.length === 2 && p.tags[0] === "عباية سوداء" && p.tags[1] === "عبايات", `CL2-4: الوسوم بلا تكرار بعد تطبيع الحروف، و«يومية» لم يذكرها التاجر تُحذف من الوسم لا الوسم كله (معيار ٦.٢، 2026-09-15) (${p.tags.join(" | ")})`);
  }
}

main().then(done);

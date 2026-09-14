// اختبارات sanitizeReviewFields (functions/_lib/domain/reviewFields.js) —
// بند "مراجعة كل حقل" (طلب المالك 2026-09-14). دالة نقية، فبلا D1 وهمي.
//
// التغطية: الحدود (طول/عدد)، تجريد HTML، إسقاط العناصر الفارغة، الشكل القديم
// {description} وحده، احترام exclude بمسار النشر (buildSallaProductFields).
import { createRunner } from "../_helpers.mjs";

const { assert, done } = createRunner("review-fields");

async function main() {
  const { sanitizeReviewFields } = await import("../../functions/_lib/domain/reviewFields.js");
  const { buildSallaProductFields } = await import("../../functions/_lib/domain/sallaProductPayload.js");

  // ── ١. الوصف: تجريد HTML وقص الطول ───────────────────────────────────────
  {
    const patch = sanitizeReviewFields({ description: "  <b>مرحباً</b> بالعالم  " });
    assert(patch.description === "مرحباً بالعالم", "RF-1: الوصف يُجرَّد من HTML ويُقص");

    const long = "س".repeat(6000);
    const p2 = sanitizeReviewFields({ description: long });
    assert(p2.description.length === 5000, "RF-2: الوصف يُقص لحد ٥٠٠٠");

    const p3 = sanitizeReviewFields({ description: "   " });
    assert(p3.description === undefined, "RF-3: وصف فارغ بعد التنظيف لا يُضاف للـpatch");
  }

  // ── ٢. النبذة والنقاط ────────────────────────────────────────────────────
  {
    const patch = sanitizeReviewFields({ excerpt: "<i>نبذة</i> قصيرة" });
    assert(patch.copywriting?.excerpt === "نبذة قصيرة", "RF-4: النبذة تُجرَّد من HTML وتُدمج تحت copywriting.excerpt");

    const many = Array.from({ length: 12 }, (_, i) => `ميزة ${i}`);
    const p2 = sanitizeReviewFields({ highlights: many });
    assert(p2.copywriting?.highlights?.length === 8, "RF-5: النقاط تُقص لحد ٨ عناصر");

    const withEmpty = ["جيد", "  ", "<script></script>", "ممتاز"];
    const p3 = sanitizeReviewFields({ highlights: withEmpty });
    assert(p3.copywriting?.highlights?.length === 2, "RF-6: العناصر الفارغة (بعد تجريد HTML) تُسقط من النقاط");
  }

  // ── ٣. الأسئلة الشائعة والمواصفات ────────────────────────────────────────
  {
    const faqs = [
      { q: "كم السعر؟", a: "استشارة مجانية." },
      { q: "بلا جواب", a: "" },
      { q: "", a: "بلا سؤال" }
    ];
    const patch = sanitizeReviewFields({ faqs });
    assert(patch.faqs.length === 1, "RF-7: أسئلة بلا سؤال أو جواب تُسقط");
    assert(patch.faqs[0].q === "كم السعر؟", "RF-8: السؤال الصالح يبقى كما هو بعد التعقيم");

    const specsTable = [{ key: "الخامة", value: "قطن" }, { key: "", value: "لا مفتاح" }];
    const p2 = sanitizeReviewFields({ specsTable });
    assert(p2.specsTable.length === 1 && p2.specsTable[0].key === "الخامة", "RF-9: صف مواصفات بلا مفتاح يُسقط");
  }

  // ── ٤. السيو ─────────────────────────────────────────────────────────────
  {
    const patch = sanitizeReviewFields({ seo: { seoTitle: "س".repeat(100), metaDescription: "وصف بحث" } }, {});
    assert(patch.seo.seoTitle.length === 70, "RF-10: عنوان السيو يُقص لحد ٧٠");
    assert(patch.seo.metaDescription === "وصف بحث", "RF-11: وصف السيو الميتا يمر كما هو ضمن الحد");

    // الدمج فوق القيم الحالية لا الكتابة فوقها بالكامل.
    const current = { seo: { title: "عنوان أصلي", focusKeyword: "كلمة" } };
    const p2 = sanitizeReviewFields({ seo: { seoTitle: "عنوان جديد" } }, current);
    assert(p2.seo.title === "عنوان أصلي" && p2.seo.seoTitle === "عنوان جديد", "RF-12: تعديل حقل سيو واحد لا يمحو البقية");
  }

  // ── ٥. exclude: description لا يُستبعد أبداً (لا مفتاح له بالمخطط) ──────
  {
    const patch = sanitizeReviewFields({ exclude: { faqs: true, seo: true, description: true } }, {});
    assert(patch.exclude.faqs === true && patch.exclude.seo === true, "RF-13: exclude يقبل الأقسام المسموحة");
    assert(patch.exclude.description === undefined, "RF-14: description ليس مفتاحاً مسموحاً بـexclude");

    // الدمج الجزئي: استبعاد قسم لا يمحو استبعاد قسم آخر سابق.
    const p2 = sanitizeReviewFields({ exclude: { highlights: true } }, { exclude: { faqs: true } });
    assert(p2.exclude.faqs === true && p2.exclude.highlights === true, "RF-15: exclude يُدمج جزئياً فوق الحالي");
  }

  // ── ٦. مفاتيح غير معروفة تُتجاهل بصمت ────────────────────────────────────
  {
    const patch = sanitizeReviewFields({ description: "نص صالح", unknownKey: "شيء", price: 999 });
    assert(patch.description === "نص صالح", "RF-16: مفتاح غير معروف لا يوقف تعقيم الحقول الصالحة");
    assert(patch.unknownKey === undefined && patch.price === undefined, "RF-17: المفاتيح غير المعروفة لا تصل الـpatch");
  }

  // ── ٧. الشكل القديم: {description} فقط (بلا fields أخرى) ────────────────
  {
    const patch = sanitizeReviewFields({ description: "وصف قديم الشكل" });
    assert(Object.keys(patch).length === 1 && patch.description === "وصف قديم الشكل", "RF-18: الشكل القديم {description} وحده ما زال يعمل");
  }

  // ── ٨. exclude يُحترم فعلياً بمسار النشر (buildSallaProductFields) ──────
  {
    const base = {
      description: "وصف المنتج الكامل.",
      excerpt: "نبذة ستُستبعد",
      highlights: ["ميزة أولى"],
      faqs: [{ q: "سؤال؟", a: "جواب." }],
      specsTable: [{ key: "الوزن", value: "١كغم" }],
      seo: { seoTitle: "عنوان بحث", metaDescription: "وصف بحث" }
    };

    const full = buildSallaProductFields(base);
    assert(full.fields.subtitle, "RF-19: بلا استبعاد — subtitle يُبنى من النبذة");
    assert(/ميزة أولى/.test(full.fields.description), "RF-20: بلا استبعاد — النقاط تظهر بوصف الـHTML");
    assert(full.fields.metadata_title === "عنوان بحث", "RF-21: بلا استبعاد — عنوان السيو يُنشر");

    // نفس الحمولة لكن بعد تطبيق exclude (كما يفعل publish.js على payload.exclude)
    const excluded = buildSallaProductFields({
      ...base,
      excerpt: "", // excerpt.exclude=true
      highlights: [], // highlights.exclude=true
      faqs: [], // faqs.exclude=true
      specsTable: [], // specsTable.exclude=true
      seo: null // seo.exclude=true
    });
    assert(!excluded.fields.subtitle, "RF-22: excerpt مستبعد ⇒ لا subtitle");
    assert(!/ميزة أولى/.test(excluded.fields.description), "RF-23: highlights مستبعد ⇒ لا نقاط بالوصف");
    assert(!/سؤال؟/.test(excluded.fields.description), "RF-24: faqs مستبعد ⇒ لا أسئلة شائعة بالوصف");
    assert(!/الوزن/.test(excluded.fields.description), "RF-25: specsTable مستبعد ⇒ لا مواصفات بالوصف");
    assert(!excluded.fields.metadata_title && !excluded.fields.metadata_description, "RF-26: seo مستبعد ⇒ لا حقول metadata_*");
    assert(/وصف المنتج الكامل/.test(excluded.fields.description), "RF-27: الوصف الأساسي يُنشر دائماً رغم استبعاد باقي الأقسام");
  {
    const { buildSallaProductFields } = await import("../../functions/_lib/domain/sallaProductPayload.js");
    const base = { description: "وصف", excerpt: "نبذة قديمة", copywriting: { excerpt: "نبذة قديمة" } };
    const patch = sanitizeReviewFields({ excerpt: "" }, base);
    const merged = { ...base, ...patch };
    const excerpt = merged.copywriting?.excerpt || merged.excerpt || "";
    assert(excerpt === "" && !buildSallaProductFields({ description: "وصف", excerpt }).fields.subtitle, "RF-EXCERPT-CLEAR: نبذة أفرغها التاجر لا ترجع من الحقل القديم");
  }
  {
    const { readFileSync } = await import("node:fs");
    const bulkSrc = readFileSync(new URL("../../functions/_lib/domain/bulk.js", import.meta.url), "utf8");
    const fn = bulkSrc.slice(bulkSrc.indexOf("export async function markDeferredItems"), bulkSrc.indexOf("export async function markDeferredItems") + 1600);
    assert(/SET status = 'done'[^"]*processed >= total/.test(fn) && /status = 'running', processed = processed -/.test(bulkSrc), "BULK-DEFER-DONE: وظيفة كل صفوفها مؤجَّلة تُغلق، والإحياء يعيد فتحها");
  }
  {
    const { readFileSync } = await import("node:fs");
    const pub = readFileSync(new URL("../../functions/_lib/domain/publish.js", import.meta.url), "utf8");
    assert(/productId \? updateProduct\(token, productId, body\) : updateProductBySku\(token, sku, body\)/.test(pub) && /return write\(fallback\)/.test(pub) && /revertId \? updateProduct\(/.test(pub),
      "PUB-BY-ID: النشر والتراجع بمعرّف منتج سلة أولاً والـSKU احتياط (SKU التجريبي بشرطة أخيرة يرجع 404)");
  }
  }

  done();
}

main();

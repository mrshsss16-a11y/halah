import { createRunner, readComposedPage } from "../_helpers.mjs";

const { assert, done } = createRunner("copy-taxonomy");

async function main() {
  // ── كتيب مصطلحات المنتجات (مفردات محكومة حسب الفئة) ──────────────────
  {
    const { taxonomyForCategory, COVERED_CATEGORIES } = await import("../../functions/_lib/ai/productTaxonomy.js");
    const { VISION_PROMPT, visionPromptFor, buildSeoSystem } = await import("../../functions/_lib/ai/prompts/seo.js");

    const dresses = taxonomyForCategory("فساتين");
    assert(
      COVERED_CATEGORIES.includes("فساتين") && dresses.length > 0,
      "TAX-1: فئة الفساتين مغطاة بكتيب مصطلحات"
    );
    assert(
      ["قصّة A", "ماكسي", "ميدي", "ميني", "قفطان", "بذيل حورية", "بلوزون"].every((t) => dresses.includes(t)),
      "TAX-2: مصطلحات القصّة/السيلويت موجودة بالنص"
    );
    assert(
      ["دائرية", "V", "قارب", "مربعة", "واقفة", "حمالات", "مكشوفة الكتفين"].every((t) => dresses.includes(t)),
      "TAX-3: مصطلحات الياقة موجودة بالنص"
    );
    assert(
      ["ثلاثة أرباع", "بلا أكمام", "منفوخة", "فراشة", "ضيّقة"].every((t) => dresses.includes(t)),
      "TAX-4: مصطلحات الأكمام موجودة بالنص"
    );
    assert(
      ["حزام", "كسرات", "طبقات", "شق جانبي", "أزرار أمامية", "تطريز ظاهر", "منقّطة", "مخططة"].every((t) => dresses.includes(t)),
      "TAX-5: التفاصيل المرئية والطبعة موجودة بالنص"
    );
    assert(
      ["سهرات", "مناسبات", "يومي", "عمل", "صيفي", "شتوي"].every((t) => dresses.includes(t)),
      "TAX-6: الاستخدام المقترح موجود بالنص"
    );

    // الكتيب مفردات وصف — لا خامات ولا أحكام جودة تتسلل من الباب الخلفي.
    assert(
      !/(فاخر|أنيق|عالي الجودة|جودة عالية|مريح|شيفون|كريب|ساتان|قطن|حرير)/.test(dresses),
      "TAX-7: الكتيب بلا خامات ولا أحكام جودة — تسمية فقط"
    );

    // فئة غير مغطاة أو غائبة ⇒ التوجيه القديم حرفياً (نمط SP-12).
    assert(
      taxonomyForCategory("عطور") === "" && taxonomyForCategory("") === "" &&
        taxonomyForCategory(undefined) === "" && taxonomyForCategory(null) === "",
      "TAX-8: فئة غير مغطاة أو غائبة ترجّع كتيباً فارغاً لا كتيباً مخترعاً"
    );
    assert(
      visionPromptFor("عطور") === VISION_PROMPT && visionPromptFor("") === VISION_PROMPT &&
        visionPromptFor(undefined) === VISION_PROMPT,
      "TAX-9: بلا كتيب، توجيه الرؤية مطابق حرفياً للسلوك السابق"
    );

    const withTax = visionPromptFor("فساتين");
    assert(
      withTax.startsWith(VISION_PROMPT) && withTax.includes(dresses),
      "TAX-10: الكتيب يُحقن فوق التوجيه القديم بلا استبداله"
    );
    assert(
      /استخدم المصطلحات التالية حصراً/.test(withTax) && /ولا تخترع بديلاً/.test(withTax),
      "TAX-11: الحقن يحصر التسمية بالمعجم ويمنع اختراع بديل"
    );
    // الكتيب لا ينقض منع الاختلاق — قواعد VIS ما زالت بالنص المحقون.
    assert(
      /ممنوع الاستنتاج أو الافتراض/.test(withTax) && /عند أي شك لا تذكر الخامة إطلاقاً/.test(withTax),
      "TAX-12: منع الاختلاق باقٍ حرفياً بعد الحقن"
    );
    // مرادفات الفئة كما يكتبها التاجر فعلاً.
    assert(
      taxonomyForCategory("الفساتين") === dresses && taxonomyForCategory("ازياء نسائيه") === dresses &&
        taxonomyForCategory("Dresses") === dresses,
      "TAX-13: مرادفات الفئة تُطبَّع (تشكيل/همزة/تاء مربوطة/لاتيني)"
    );

    // إلزام الاتساق بالوصف النهائي — يُحقن فقط مع رؤية + كتيب.
    const seoArgs = { recent: [], keywords: ["فستان"], existingDescription: "", styleExamples: [] };
    const seoWithBoth = buildSeoSystem({ ...seoArgs, visionNotes: "فستان ماكسي بقصّة A.", taxonomyBlock: dresses });
    assert(
      /التزمي بنفس مصطلحات ملاحظات الصورة حرفياً/.test(seoWithBoth) && /لا مرادفات/.test(seoWithBoth),
      "TAX-14: الوصف النهائي مُلزَم بنفس المصطلحات لا بمرادفاتها"
    );
    const seoNoTax = buildSeoSystem({ ...seoArgs, visionNotes: "فستان ماكسي بقصّة A." });
    assert(
      seoNoTax === buildSeoSystem({ ...seoArgs, visionNotes: "فستان ماكسي بقصّة A.", taxonomyBlock: "" }) &&
        !/التزمي بنفس مصطلحات/.test(seoNoTax),
      "TAX-15: بلا كتيب، البرومبت الرئيسي مطابق حرفياً للسلوك السابق"
    );
    assert(
      !/التزمي بنفس مصطلحات/.test(buildSeoSystem({ ...seoArgs, visionNotes: "", taxonomyBlock: dresses })),
      "TAX-16: بلا ملاحظات صورة لا يُحقن إلزام الاتساق"
    );
    // حجم البرومبت تكلفة بكل استدعاء.
    assert(dresses.length < 700, `TAX-17: الكتيب مختصر (${dresses.length} حرفاً)`);

    // ── الفئات المضافة من قاموس المصطلحات السعودي (2026-09-08) ──
    const abayas = taxonomyForCategory("عبايات");
    const jewelry = taxonomyForCategory("مجوهرات");
    const apparel = taxonomyForCategory("ملابس");
    assert(
      [abayas, jewelry, apparel].every((t) => t.length > 0) &&
        ["عبايات", "مجوهرات", "ملابس"].every((c) => COVERED_CATEGORIES.includes(c)),
      "TAX-18: عبايات/مجوهرات/ملابس مغطاة بكتيب مصطلحات"
    );
    assert(
      ["كلوش", "بشت", "فراشة", "مطرزة", "مفتوحة"].every((t) => abayas.includes(t)),
      "TAX-19: مصطلحات العبايات من القاموس موجودة"
    );
    assert(
      ["تشوكر", "سوليتير", "دبلة", "خلخال", "أقراط متدلية", "مرصّع"].every((t) => jewelry.includes(t)),
      "TAX-20: مصطلحات المجوهرات من القاموس موجودة"
    );
    assert(
      ["أوفر سايز", "بوكسي", "بليزر", "بليسيه", "واسع الساق"].every((t) => apparel.includes(t)),
      "TAX-21: مصطلحات الملابس من القاموس موجودة"
    );
    // المجوهرات: الصورة تُظهر لون المعدن لا مادته — لا ادعاء "ذهب" أو "ألماس".
    assert(
      /ذهبي أصفر/.test(jewelry) &&
        !/ألماس|زركون|استرليني/.test(
          jewelry.split("\n").filter((l) => l.startsWith("- ")).join("\n")
        ) &&
        /لا تُسمّي معدناً ولا حجراً بيقين/.test(jewelry),
      "TAX-22: معجم المجوهرات يسمّي اللون لا المادة (لا ادعاء ذهب/ألماس)"
    );
    // نفس قاعدة TAX-7 مطبَّقة على كل الفئات الجديدة: لا خامات ولا أحكام جودة.
    assert(
      [abayas, jewelry, apparel].every(
        (t) => !/(فاخر|أنيق|عالي الجودة|جودة عالية|مريح|شيفون|كريب|ساتان|قطن|حرير|مخمل|دانتيل|كتان|دنيم|تريكو|كشمير)/.test(t)
      ),
      "TAX-23: الفئات الجديدة بلا خامات ولا أحكام جودة"
    );
    assert(
      [abayas, jewelry, apparel].every((t) => t.length < 700),
      "TAX-24: كل كتيب فئة مختصر (<700 حرف)"
    );
    assert(
      taxonomyForCategory("عباية") === abayas && taxonomyForCategory("اكسسوارات") === jewelry &&
        taxonomyForCategory("Jewelry") === jewelry && taxonomyForCategory("ازياء") === apparel,
      "TAX-25: مرادفات الفئات الجديدة تُطبَّع"
    );
    // لا تلوّث متبادل: معجم كل فئة مستقل.
    assert(
      !abayas.includes("تشوكر") && !jewelry.includes("قصّة A") && !apparel.includes("بذيل حورية"),
      "TAX-26: لا تسرّب مفردات بين الفئات"
    );

    // ── احتياط اسم المنتج حين تكون فئة المتجر خاطئة (رُصد بفيديو 2026-09-08:
    //    منتج "فستان" مصنَّف تحت "البلايز" ⇒ سقط الكتيب كله بصمت) ──
    const { taxonomyForProduct } = await import("../../functions/_lib/ai/productTaxonomy.js");
    assert(
      taxonomyForProduct({ category: "البلايز", name: "فستان" }) === dresses &&
        taxonomyForProduct({ category: "", name: "عباية كلوش" }) === abayas,
      "TAX-27: فئة غير مطابقة تسقط لاسم المنتج بدل إسقاط الكتيب"
    );
    assert(
      taxonomyForProduct({ category: "فساتين", name: "قلادة ذهب" }) === dresses,
      "TAX-28: الفئة أسبق دائماً — الاسم مصدر احتياطي لا بديل"
    );
    // البحث الجزئي بالاسم هو ما أُغلقت القائمة لمنعه — الكلمة الأولى فقط.
    assert(
      taxonomyForProduct({ category: "شنط", name: "شنطة تناسب الفساتين" }) === "" &&
        taxonomyForProduct({ category: "", name: "حزام يناسب الفساتين" }) === "",
      "TAX-29: اسم يذكر فئة أخرى عرضاً لا يحقن معجمها"
    );
    assert(
      taxonomyForProduct({ category: "", name: "" }) === "" &&
        taxonomyForProduct({}) === "" && taxonomyForProduct() === "",
      "TAX-30: غياب الفئة والاسم يرجّع كتيباً فارغاً لا يرمي"
    );
    // مسار الرؤية يستهلك الكتيب نفسه أياً كان مصدره.
    const { visionPromptFromTaxonomy } = await import("../../functions/_lib/ai/prompts/seo.js");
    assert(
      visionPromptFromTaxonomy("") === VISION_PROMPT &&
        visionPromptFromTaxonomy(dresses) === visionPromptFor("فساتين"),
      "TAX-31: بناء توجيه الرؤية واحد سواء جاء الكتيب من الفئة أو الاسم"
    );
  }

  // ── مراجعة السيو ومطابقة حقول سلة (2026-09-08) ─────────────────────────
  {
    const { readFileSync } = await import("node:fs");
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const { buildSallaProductFields, composeDescriptionHtml } = await import("../../functions/_lib/domain/sallaProductPayload.js");

    const built = buildSallaProductFields({
      description: "عباية سوداء بقصّة A.\n\nتناسب المناسبات المسائية.",
      excerpt: "عباية سوداء أنيقة للمناسبات. تفاصيل إضافية هنا.",
      highlights: ["قصّة A", "<script>x</script>"],
      faqs: [{ q: "هل تتوفر مقاسات؟", a: "حسب المتجر." }, { q: "", a: "بلا سؤال" }],
      seo: { seoTitle: "عباية سوداء بقصّة A | متجر", metaDescription: "عباية سوداء بقصّة A تناسب المناسبات — اطلبيها الآن.", slug: "عباية-سوداء" }
    });
    assert(
      "metadata_title" in built.fields && "metadata_description" in built.fields && "subtitle" in built.fields && !("metadata" in built.fields),
      "SALLA-1: حقول السيو بأسمائها الرسمية من المستوى الأعلى (metadata_title/metadata_description/subtitle) — لا كائن metadata"
    );
    assert(!("metadata_url" in built.fields) && !("slug" in built.fields), "SALLA-2: metadata_url لا يُرسل أبداً — لا تغيير لرابط منتج مفهرس");
    assert(
      /^<p>عباية سوداء بقصّة A\.<\/p><p>تناسب المناسبات المسائية\.<\/p><ul><li>قصّة A<\/li><li>&lt;script&gt;x&lt;\/script&gt;<\/li><\/ul><h3>هل تتوفر مقاسات؟<\/h3><p>حسب المتجر\.<\/p>$/.test(built.fields.description),
      "SALLA-3: الوصف HTML منظّم (فقرات + نقاط + أسئلة)، كل نص مهرَّب، والسؤال الفارغ يُسقط"
    );
    assert(built.fields.subtitle === "عباية سوداء أنيقة للمناسبات." && built.fields.metadata_title.length <= 65 && built.fields.metadata_description.length <= 160, "SALLA-4: subtitle أول جملة من النبذة، وحدود ٦٥/١٦٠ للعنوان/الوصف");
    assert(built.descriptionOnly.description === built.fields.description && Object.keys(built.descriptionOnly).length === 1 && built.hasSeo === true, "SALLA-5: حمولة الاحتياط (٤٢٢) = الوصف وحده");
    let emptyThrew = false;
    try { buildSallaProductFields({ description: "   " }); } catch { emptyThrew = true; }
    assert(emptyThrew && composeDescriptionHtml({}) === "", "SALLA-6: وصف فارغ يرمي — لا نشر لصفحة فارغة");
    const noSeo = buildSallaProductFields({ description: "نص" });
    assert(noSeo.hasSeo === false && Object.keys(noSeo.fields).join() === "description", "SALLA-7: بلا سيو = حقل الوصف فقط، لا حقول فارغة تمسح ما عند التاجر");

    // الصدق: لا قيم افتراضية مخترعة بمحرك الوصف.
    const copySrc = read("../../functions/_lib/domain/copyParse.js") + read("../../functions/_lib/ai/prompts/seo.js");
    assert(
      !/ضمان سنتين/.test(copySrc) && !/2-5 أيام/.test(copySrc) && !/جودة عالية مضمونة/.test(copySrc) && !/أفضل جودة وسعر/.test(copySrc) && !/InStock/.test(copySrc) && !/price \|\| "0"/.test(copySrc),
      "SALLA-8: صفر ضمان/توصيل/توفر/سعر مخترع بسقوط parseSeoResponse (§11)"
    );
    assert(/لا مواصفة معروفة = لا نقطة/.test(copySrc) && /٣-٥ جمل/.test(copySrc), "SALLA-9: البرومبت يمنع نقاط مخترعة ويطلب وصفاً بحجم صفحة منتج");
    const sallaSrc = read("../../functions/_lib/integrations/salla.js");
    assert(/err\.status = res\.status/.test(sallaSrc) && /Retry-After/.test(sallaSrc), "SALLA-10: أخطاء سلة مصنَّفة بالحالة وRetry-After (توثيق حد المعدل)");
    // lastCopy صار S.lastCopy بحالة مشتركة state.js بعد التقسيم.
    const dash = await readComposedPage("dashboard");
    assert(/copywriting:\s*S\.lastCopy\.copywriting \|\| null/.test(dash) && /function publishExtras/.test(dash), "SALLA-11: النشر المفرد يرسل النقاط/الأسئلة، وشاشة المراجعة تعرض ما يُنشر مع الوصف");
  }
}

main()
  .then(() => done())
  .catch((e) => {
    console.error("❌ Tests threw an exception:");
    console.error(e);
    process.exit(1);
  });

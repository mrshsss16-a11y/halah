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

    // فئة غير مغطاة أو غائبة ⇒ التوجيه القديم حرفياً (نمط SP-12). («عطور» صارت مغطاة بمكتبة 2026-09-11.)
    assert(
      taxonomyForCategory("سيارات") === "" && taxonomyForCategory("") === "" &&
        taxonomyForCategory(undefined) === "" && taxonomyForCategory(null) === "",
      "TAX-8: فئة غير مغطاة أو غائبة ترجّع كتيباً فارغاً لا كتيباً مخترعاً"
    );
    assert(
      visionPromptFor("سيارات") === VISION_PROMPT && visionPromptFor("") === VISION_PROMPT &&
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
      taxonomyForCategory("عباية") === abayas && taxonomyForCategory("خواتم") === jewelry &&
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
      taxonomyForProduct({ category: "سيارات", name: "معطر سيارة يناسب الفساتين" }) === "" &&
        taxonomyForProduct({ category: "", name: "علّاقة تناسب الفساتين" }) === "",
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
    assert(/لا مواصفة معروفة = لا نقطة/.test(copySrc) && /٤٠-١٥٠ كلمة حسب الحقائق المتاحة/.test(copySrc), "SALLA-9: البرومبت يمنع نقاط مخترعة ويطلب وصفاً بقدر الحقائق المتاحة (معيار هالة: لا حشو)");
    const sallaSrc = read("../../functions/_lib/integrations/salla.js");
    assert(/err\.status = res\.status/.test(sallaSrc) && /Retry-After/.test(sallaSrc), "SALLA-10: أخطاء سلة مصنَّفة بالحالة وRetry-After (توثيق حد المعدل)");
    // lastCopy صار S.lastCopy بحالة مشتركة state.js بعد التقسيم.
    const dash = await readComposedPage("dashboard");
    assert(/copywriting:\s*S\.lastCopy\.copywriting \|\| null/.test(dash) && /function publishExtras/.test(dash), "SALLA-11: النشر المفرد يرسل النقاط/الأسئلة، وشاشة المراجعة تعرض ما يُنشر مع الوصف");
  }

  {
    const { taxonomyForCategory, taxonomyForProduct, COVERED_CATEGORIES } = await import("../../functions/_lib/ai/productTaxonomy.js");
    // ── الثماني من مكتبة أوصاف المنتجات السعودية (2026-09-11) ──
    const LIB = ["ملابس رجالية", "ملابس أطفال", "أحذية", "حقائب", "إكسسوارات", "عناية وجمال", "منزل وهدايا", "إلكترونيات"];
    assert(LIB.every((c) => COVERED_CATEGORIES.includes(c) && taxonomyForCategory(c).length > 0), "TAX-40: الفئات الثماني من المكتبة مغطاة");
    assert(LIB.every((c) => taxonomyForCategory(c).length < 700), "TAX-41: كل كتيب من المكتبة مختصر (<700 حرف)");
    assert(
      LIB.every((c) => !/(فاخر|أنيق|عالي الجودة|جودة عالية|مريح|شيفون|كريب|ساتان|قطن|حرير|جلد|ذهب|فضة|كتان|مخمل|دانتيل|لؤلؤ|زركون)/.test(taxonomyForCategory(c))),
      "TAX-42: كتيبات المكتبة بلا خامات ولا معادن ولا أحكام جودة — المكتبة نفسها تقول إنها «تحتاج إثباتاً»"
    );
    assert(
      taxonomyForCategory("شنط") === taxonomyForCategory("حقائب") && taxonomyForCategory("Shoes") === taxonomyForCategory("أحذية") &&
        taxonomyForCategory("عطور") === taxonomyForCategory("عناية وجمال") && taxonomyForCategory("الكترونيات") === taxonomyForCategory("إلكترونيات"),
      "TAX-43: مرادفات التاجر الشائعة (شنط/Shoes/عطور/الكترونيات) تصل لكتيب المكتبة"
    );
    assert(taxonomyForCategory("إكسسوارات") !== taxonomyForCategory("مجوهرات") && /نظارة شمسية/.test(taxonomyForCategory("إكسسوارات")), "TAX-44: «إكسسوارات» صارت كتيباً مستقلاً (أحزمة/نظارات/شالات) لا مجوهرات");
    assert(taxonomyForProduct({ category: "جديد", name: "حذاء رياضي أبيض" }) === taxonomyForCategory("أحذية"), "TAX-45: الكلمة الأولى من الاسم توصل لكتيب المكتبة عند فئة غير مطابقة");
    assert(taxonomyForProduct({ category: "", name: "قميص رجالي" }) === "" && taxonomyForProduct({ category: "", name: "غطاء هاتف" }) === "", "TAX-46: الكلمات المشتركة بين فئتين (قميص/غطاء) لا تُوجَّه — تحويل خاطئ أسوأ من لا كتيب");
    assert(/الأداء يحتاج إثباتاً/.test(taxonomyForCategory("أحذية")) && /ممنوع استنتاجها من الصورة/.test(taxonomyForCategory("إلكترونيات")), "TAX-47: كتيبات الفئات غير المرئية تحمل تحذير المصدر (I004/I008/I010)");
  }
}

main()
  .then(() => done())
  .catch((e) => {
    console.error("❌ Tests threw an exception:");
    console.error(e);
    process.exit(1);
  });

  // ── تصحيح التصنيف — رُصد فستان تحت «التنانير» (2026-09-09) ──────────
  {
    const { detectProductType, categoryMismatch, productTypeOf, KNOWN_TYPES } =
      await import("../../functions/_lib/ai/productType.js");

    assert(
      productTypeOf("فستان سهرة أخضر") === "فستان" && productTypeOf("عبايات") === "عباية" &&
        productTypeOf("التنانير") === "تنورة",
      "CAT-1: النوع يُستنتج من الكلمة الأولى مع تطبيع الجمع والتعريف"
    );
    // الحالة الحقيقية من الفيديو.
    const m = categoryMismatch({
      visionNotes: "فستان قصير مطبوع عليه زهور، ياقة قميص وأكمام قصيرة.",
      name: "فستان",
      category: "التنانير"
    });
    assert(
      m && m.detected === "فستان" && m.current === "تنورة",
      "CAT-2: فستان مصنَّف تحت التنانير يُرصد بيقين"
    );
    assert(
      categoryMismatch({ visionNotes: "فستان طويل", name: "فستان", category: "فساتين" }) === null,
      "CAT-3: تصنيف مطابق ⇒ لا تنبيه"
    );
    // تصنيف تسويقي مشروع ليس خطأً — لا تنبيه بلا تعارض نوعين معروفين.
    assert(
      categoryMismatch({ visionNotes: "فستان طويل", name: "فستان", category: "وصل حديثاً" }) === null &&
        categoryMismatch({ visionNotes: "فستان طويل", name: "فستان", category: "" }) === null,
      "CAT-4: فئة غير معروفة أو فارغة لا تُتهم بالخطأ"
    );
    // البحث الجزئي هو ما أُغلقت القائمة لمنعه.
    assert(
      detectProductType({ name: "شنطة تناسب الفساتين" }) === "حقيبة" &&
        categoryMismatch({ name: "شنطة تناسب الفساتين", category: "حقائب" }) === null,
      "CAT-5: اسم يذكر فئة أخرى عرضاً لا يقلب النوع"
    );
    assert(
      detectProductType({}) === null && detectProductType({ name: "منتج مميز" }) === null &&
        categoryMismatch() === null,
      "CAT-6: نوع غير معروف ⇒ صمت لا تخمين"
    );
    // ملاحظات الصورة أسبق: شهادة بصرية تتقدّم على اسم قد يكون خاطئاً.
    assert(
      detectProductType({ visionNotes: "عباية سوداء واسعة", name: "فستان" }) === "عباية",
      "CAT-7: ملاحظات الصورة تتقدّم على اسم المنتج"
    );
    assert(KNOWN_TYPES.length >= 12, "CAT-8: قائمة الأنواع تغطي فئات المتاجر الشائعة");

    // اقتراح لا تنفيذ: صفر كتابة تصنيف على سلة.
    const { readFileSync } = await import("node:fs");
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const payload = read("../../functions/_lib/domain/sallaProductPayload.js");
    assert(
      !/categories/.test(payload),
      "CAT-9: لا تصنيف يُكتب على سلة — التنبيه اقتراح، والقرار للتاجر"
    );
    assert(
      /categoryMismatch: parsed\.categoryMismatch/.test(read("../../functions/api/copy.js")) &&
        /renderCategoryMismatch/.test(read("../../public/js/dashboard/studio.js")) &&
        /id="categoryMismatchNote"/.test(read("../../partials/dashboard-studio.html")),
      "CAT-10: التنبيه يصل الواجهة من الخادم ويُعرض"
    );
  }

  // ── تطبيق التصنيف بموافقة التاجر (2026-09-10) ────────────────────────
  {
    const { applyProductCategory } = await import("../../functions/_lib/domain/productCategory.js");
    const { readFileSync } = await import("node:fs");
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

    // بيئة وهمية: تصنيفات المتجر + منتج ينتمي لـ«التنانير» و«وصل حديثاً».
    const calls = [];
    const mkEnv = (cats, productCats) => ({
      DB: { prepare: () => ({ bind: () => ({ first: async () => ({ access_token: "t", refresh_token: "r", expires_at: 9e9 }) }) }) },
      __fetch: async (url, init) => {
        calls.push({ url, method: init?.method || "GET", body: init?.body });
        if (url.includes("/categories")) return { data: cats, pagination: { totalPages: 1 } };
        if (init?.method === "PUT") return { data: { id: 1 } };
        return { data: { id: 68358280, categories: productCats } };
      }
    });

    const cats = [
      { id: 11, name: "التنانير" },
      { id: 22, name: "الفساتين" },
      { id: 33, name: "وصل حديثاً" }
    ];
    globalThis.__HALA_TEST_FETCH = null;

    // نحقن عبر mock على وحدة التكامل بدل الشبكة.
    const salla = await import("../../functions/_lib/integrations/salla.js");
    const domainSalla = await import("../../functions/_lib/domain/salla.js");
    const origList = salla.listCategories, origGet = salla.getProduct, origUpd = salla.updateProduct;
    const origTok = domainSalla.getValidSallaToken;

    assert(
      typeof salla.listCategories === "function" && typeof salla.getProduct === "function",
      "APPLY-1: محوّل سلة يوفّر قراءة التصنيفات وتفاصيل المنتج"
    );

    // التحقق البنيوي (السلوك يُغطّى بمسار الوحدة أعلاه):
    const domainSrc = read("../../functions/_lib/domain/productCategory.js");
    assert(
      /const product = await getProduct\(token, productId\)/.test(domainSrc) &&
        /categories: next\.map\(Number\)/.test(domainSrc),
      "APPLY-2: يقرأ تصنيفات المنتج قبل الكتابة — الكتابة تستبدل المصفوفة كاملة"
    );
    assert(
      /if \(known\?\.type && known\.type !== type\)/.test(domainSrc),
      "APPLY-3: يستبدل التصنيف المتعارض وحده — التصنيفات التسويقية تبقى"
    );
    assert(
      /CATEGORY_NOT_FOUND/.test(domainSrc) && /أنشئه من تصنيفات سلة/.test(domainSrc),
      "APPLY-4: لا تصنيف مطابق ⇒ يطلب إنشاءه ولا يخترع واحداً"
    );

    const apiSrc = read("../../functions/api/store/category.js");
    assert(
      /KNOWN_TYPES\.includes\(type\)/.test(apiSrc),
      "APPLY-5: النوع من قائمة مغلقة — لا يُطبَّق نوع لم تقترحه هالة"
    );
    assert(
      /requireCompletedAccount/.test(apiSrc) && /checkRateLimit/.test(apiSrc),
      "APPLY-6: الكتابة على سلة خلف حساب مكتمل وحد معدل"
    );
    assert(
      /SCOPE_MISSING/.test(apiSrc) && /SALLA_RATE_LIMITED/.test(apiSrc),
      "APPLY-7: غياب الصلاحية وحد سلة لهما رسالتان عربيتان مميّزتان"
    );
    // لا تطبيق تلقائي: مسار التوليد لا يستدعي التطبيق إطلاقاً.
    assert(
      !/applyProductCategory/.test(read("../../functions/_lib/domain/copy.js")),
      "APPLY-8: التوليد لا يطبّق تصنيفاً — الاقتراح فقط، والتنفيذ بضغطة التاجر"
    );
    assert(
      /applySuggestedCategory/.test(read("../../public/js/dashboard/studio.js")) &&
        /id="applyCategoryBtn"/.test(read("../../partials/dashboard-studio.html")),
      "APPLY-9: زر التطبيق موجود بالواجهة ومربوط"
    );
  }

  // ── خيارات المنتج (ألوان/مقاسات) بيانات مؤكَّدة فوق الصورة (2026-09-10) ──
  {
    const { readFileSync } = await import("node:fs");
    const readF = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const { buildSeoSystem } = await import("../../functions/_lib/ai/prompts/seo.js");

    const args = { recent: [], keywords: ["فستان"], existingDescription: "", styleExamples: [] };
    const withVars = buildSeoSystem({
      ...args,
      visionNotes: "فستان أخضر فاتح بأكمام قصيرة.",
      variants: [{ name: "اللون", values: ["أخضر", "أسود", "بيج"] }, { name: "المقاس", values: ["S", "M", "L"] }]
    });
    assert(
      /خيارات المنتج المتاحة بمتجر التاجر/.test(withVars) &&
        /اللون: أخضر · أسود · بيج/.test(withVars) && /المقاس: S · M · L/.test(withVars),
      "VAR-1: الخيارات تُحقن بالبرومبت بصيغة مقروءة"
    );
    assert(
      /الخيارات هي المرجع/.test(withVars) && /لون الصورة لون النموذج المعروض/.test(withVars),
      "VAR-2: عند التعارض الخيارات تتقدّم على لون الصورة"
    );
    assert(
      /لا تذكري خياراً غير مذكور بهذي القائمة/.test(withVars),
      "VAR-3: ممنوع ادعاء لون أو مقاس غير مذكور — لا اختلاق"
    );
    // الأولوية بالترتيب: الخيارات قبل ملاحظات الصورة.
    assert(
      withVars.indexOf("خيارات المنتج المتاحة") < withVars.indexOf("ما يُرى في صورة المنتج"),
      "VAR-4: كتلة الخيارات تسبق ملاحظات الصورة بالبرومبت"
    );
    // بلا خيارات ⇒ السلوك السابق حرفياً.
    const noVars = buildSeoSystem({ ...args, visionNotes: "فستان أخضر." });
    assert(
      !/خيارات المنتج المتاحة/.test(noVars),
      "VAR-5: منتج بلا خيارات ⇒ لا كتلة ولا تغيير عن السلوك السابق"
    );
    // صف تالف لا يُسقط التوليد.
    assert(
      !/خيارات المنتج المتاحة/.test(buildSeoSystem({ ...args, visionNotes: "x", variants: "ليست مصفوفة" })) &&
        !/خيارات المنتج المتاحة/.test(buildSeoSystem({ ...args, visionNotes: "x", variants: [{ name: "اللون" }] })),
      "VAR-6: خيارات تالفة أو بلا قيم تُتجاهَل بصمت"
    );
    // السلسلة كاملة: سلة ⇒ قاعدة ⇒ list ⇒ الواجهة ⇒ التوليد، والجملة أيضاً.
    assert(
      /ALTER TABLE store_products ADD COLUMN variants/.test(readF("../../migrations/0027_store_product_variants.sql")),
      "VAR-7: هجرة 0027 تضيف عمود variants"
    );
    assert(
      /function normalizeVariants/.test(readF("../../functions/_lib/domain/catalog.js")) &&
        /variants = excluded\.variants/.test(readF("../../functions/_lib/domain/catalog.js")),
      "VAR-8: السحب يستخرج الخيارات ويحدّثها بكل مزامنة"
    );
    assert(
      /variants: r\.variants \|\| null/.test(readF("../../functions/api/store/catalog/list.js")) &&
        /variants: S\.selectedVariants/.test(readF("../../public/js/dashboard/studio.js")) &&
        /variants: catalogRow\?\.variants/.test(readF("../../functions/_lib/domain/bulkTick.js")),
      "VAR-9: الخيارات تصل المسارين — المفرد والجملة"
    );
  }

  // ── إزالة الخطوة الزايدة: النشر ملاصق للوصف + مؤشر مرحلتين ──────────
  {
    const dashV = await readComposedPage("dashboard");
    const { readFileSync } = await import("node:fs");
    const catV = readFileSync(new URL("../../public/js/dashboard/catalog.js", import.meta.url), "utf8");
    const iDesc = dashV.indexOf('id="outDescription"');
    const iPub = dashV.indexOf('id="publishBox"');
    const iSeo = dashV.indexOf("حقول السيو (SEO)");
    assert(
      iDesc > 0 && iPub > iDesc && iSeo > iPub,
      "STEP-1: زر النشر بعد الوصف مباشرة، والسيو بعده لا بينهما"
    );
    assert(
      /حقول السيو — يُنشر منها عنوان البحث ووصف الميتا فقط/.test(dashV),
      "STEP-2: السيو مطويّ ويقول صراحةً ما يُنشر منه — تفاصيل لا تفصل الفعل عن النص"
    );
    assert(
      /id="copyPendingStage"/.test(dashV) && /الخطوة ١ من ٢/.test(catV) && /الخطوة ٢ من ٢/.test(catV),
      "STEP-3: مؤشر مرحلتين يعكس نداءي الرؤية والكتابة"
    );
    assert(
      /clearTimeout\(window\.__halaStageTimer\)/.test(catV),
      "STEP-4: مؤقّت المراحل يُلغى عند الإغلاق — لا نص يتبدّل بعد الانتهاء"
    );
  }

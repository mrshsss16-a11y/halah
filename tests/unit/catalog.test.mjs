import { createRunner, readComposedPage } from "../_helpers.mjs";

const { assert, done } = createRunner("catalog");

async function main() {
  // ── واجهة "منتجاتي": نقطة قراءة الكتالوج + تدفق البطاقة بلا كتابة يدوية ───
  {
    const { readFileSync } = await import("node:fs");
    const listSrc = readFileSync(
      new URL("../../functions/api/store/catalog/list.js", import.meta.url),
      "utf8"
    );
    const dashSrc = await readComposedPage("dashboard");

    assert(
      /requireCompletedAccount\(request, env, body\.storeId\)/.test(listSrc),
      "CATUI-1: /api/store/catalog/list يتطلب حساباً مكتملاً — لا قراءة كتالوج بجلسة ناقصة"
    );
    assert(
      /checkRateLimit\(env, clientIp\(request\), "catalog_list"/.test(listSrc),
      "CATUI-2: نقطة القائمة تحت سقف معدل"
    );
    // العزل: merchantId يجي من الجلسة ويُمرَّر لطبقة الخدمة — لا معرّف من العميل.
    assert(
      /listCatalog\(env, \{ merchantId/.test(listSrc) &&
        !/merchantId:\s*body\./.test(listSrc),
      "CATUI-3: العزل عبر merchantId من الجلسة لا من جسم الطلب"
    );
    assert(
      !/\bDB\b|db\.prepare|SELECT /.test(listSrc),
      "CATUI-4: النقطة لا تلمس D1 مباشرة — كل استعلام يمرّ بـservices/catalog.js"
    );
    assert(
      // النية: صفر نداء على سلة. (اسم العمود salla_product_id قراءةٌ من D1
      // لا نداء شبكة، فيُستثنى صراحةً بدل توسيع الحظر على كلمة "salla".)
      /listProducts|integrations\/salla|sallaFetch|fetch\(/i.test(
        listSrc.replace(/salla_product_id/g, "")
      ) === false,
      "CATUI-5: التصفّح صفر طلبات على سلة — لا يُستهلك حد المتجر"
    );

    // الواجهة: تبويب منتجاتي موجود، والبطاقة تعبّي وتولّد بلا إدخال يدوي.
    assert(
      /switchTab\('catalog'\)/.test(dashSrc) && /id="sectionCatalog"/.test(dashSrc),
      "CATUI-6: تبويب «منتجاتي» وقسمه موجودان بلوحة التاجر"
    );
    const useFn = dashSrc.slice(dashSrc.indexOf("function useCatalogItem"));
    // حدّ الدالة لا عدد أحرف ثابت (2026-09-10): نافذة الـ١٤٠٠ حرف كانت تقيس
    // «generateCopy داخل useCatalogItem» بمسطرة خاطئة — تغيّر في تركيب الصفحة
    // دفع بداية النداء إلى الحرف ١٣٩١ فخرج آخره عن النافذة والدالة لم تتغيّر. نهاية
    // جسم الدالة (أول سطر «}» بلا إزاحة) هي المعنى المقصود، ومستقلة عن نهايات الأسطر.
    const NL = String.fromCharCode(10);
    const useFnEndIdx = useFn.indexOf(NL + "}");
    const useFnEnd = useFnEndIdx > 0 ? useFnEndIdx : useFn.length;
    // بعد التقسيم public/js/dashboard/catalog.js يستخدم اقتباساً مزدوجاً — نفس المعنى.
    assert(
      /pName["']\)\.value = it\.name/.test(useFn) &&
        /pImageUrl["']\)\.value = it\.imageUrl/.test(useFn) &&
        /pExistingDescription["']\)\.value = it\.currentDescription/.test(useFn) &&
        /askCatalogItemNote\(it\);/.test(useFn.slice(0, useFnEnd)) && /export function confirmCatalogItem\(\)[\s\S]*?generateCopy\(\);/.test(dashSrc),
      "CATUI-7: الضغط على بطاقة يعبّي الحقول (اسم/صورة/وصف حالي) ويسأل «وش يميزه؟» ثم يولّد"
    );
    assert(
      /catalogEmpty[\s\S]{0,400}ما سحبنا منتجاتك بعد/.test(dashSrc),
      "CATUI-8: حالة فارغة صريحة توجّه للسحب"
    );
    // CATUI-9 انقلب عمداً 2026-09-10 بدمج «منتجاتي» مع «وصف المنتجات»:
    // المسار الأساسي لم يعد يعرض **رابط** الصورة إطلاقاً — يعرض الصورة نفسها
    // برأس لوحة الوصف. رابط نصّي طويل كان تشويشاً لا معلومة. الحقل بقي داخل
    // <details> للمسار اليدوي وحده (منتج غير مسحوب من سلة).
    assert(
      /id="studioManual"[\s\S]*?id="pImageUrl"/.test(dashSrc) &&
        /id="copyResultImg"/.test(dashSrc),
      "CATUI-9: المسار الأساسي يعرض صورة المنتج لا رابطها؛ الحقل للمسار اليدوي"
    );
    assert(
      !/تحسين وصف موجود بدل كتابة من الصفر/.test(dashSrc),
      "CATUI-10: العنوان المضلّل «تحسين وصف موجود» أُزيل"
    );
    // المسار اليدوي باقٍ: الحقول قابلة للكتابة وgenerateCopy تقرأ من الحقول.
    // بعد التقسيم public/js/dashboard/studio.js يستخدم اقتباساً مزدوجاً — نفس المعنى.
    assert(
      /id="pName"[^>]*type="text"/.test(dashSrc) &&
        /const name = document\.getElementById\((['"])pName\1\)\.value\.trim\(\)/.test(dashSrc),
      "CATUI-11: المسار اليدوي (كتابة الاسم بلا اختيار منتج) لم يُحذف"
    );
    // تهريب HTML إلزامي على كل محتوى سلة داخل البطاقة.
    // حدّ الدالة نفسها لا ما بعدها: أُضيفت دوال الاختيار المتعدد بينها وبين
    // useCatalogItem، وقوالبها (${n}) عدّادات لا محتوى من سلة.
    const cardStart = dashSrc.indexOf("function catalogCard");
    const cardFn = dashSrc.slice(cardStart, dashSrc.indexOf("return wrap;", cardStart));
    const interpolations = cardFn.match(/\$\{[^}]*\}/g) || [];
    assert(
      interpolations.length > 0 &&
        // المسموح بلا escHtml: قِطَع HTML مبنيّة داخلياً (img/badge) وأعلام
        // ثابتة لا تحمل نصاً من سلة. أي شيء غير ذلك لازم يمرّ بـescHtml.
        interpolations.every((s) =>
          /escHtml\(/.test(s) || /^\$\{(img|badge|skuBadge|noImageIcon|it\.imageUrl \? (['"])hidden\2 : \2\2)\}$/.test(s)
        ),
      "CATUI-12: كل محتوى سلة داخل بطاقة المنتج يمرّ بـescHtml — ثغرة XSS لا تُعاد"
    );
    assert(
      /onerror=/.test(cardFn) && /img-fallback/.test(cardFn),
      "CATUI-13: صورة سلة المحمية تسقط لبديل بدل أيقونة مكسورة"
    );
  }

  // ── وجهة النشر تُضبط آلياً من المنتج المختار (صفر كتابة) ──────────────
  {
    console.log("\n--- Publish target auto-fill ---");
    const { readFileSync } = await import("node:fs");
    const listSrc = readFileSync(
      new URL("../../functions/api/store/catalog/list.js", import.meta.url), "utf8"
    );
    const dashSrc = await readComposedPage("dashboard");

    assert(
      /productId:\s*r\.salla_product_id\s*\|\|\s*null/.test(listSrc),
      "PUB-1: /catalog/list يُرجع معرّف المنتج بسلة لكل عنصر"
    );
    assert(
      /setPublishTarget\(it\.productId, it\.name\)/.test(dashSrc),
      "PUB-2: اختيار منتج من الكتالوج يضبط وجهة النشر آلياً"
    );
    assert(
      /<select id="publishProduct"/.test(dashSrc) && !/id="publishProduct"[^>]*(disabled|readonly)/.test(dashSrc),
      "PUB-3: المسار اليدوي باقٍ — حقل النشر موجود وقابل للتعديل"
    );
    assert(
      /onchange="onPublishProductChange\(\)"/.test(dashSrc) && /function onPublishProductChange\(/.test(dashSrc),
      "PUB-4: التغيير اليدوي للقائمة يحدّث الوجهة المعروضة"
    );
    assert(
      /'سينشر على: <span class="font-black">' \+ escHtml\(/.test(dashSrc),
      "PUB-5: اسم المنتج يُعرض مهرَّباً بـescHtml (لا حقن من سلة)"
    );
    assert(
      /اختر المنتج أولاً من تبويب «منتجاتي»/.test(dashSrc)
        && /ولّد الوصف أولاً قبل النشر/.test(dashSrc),
      "PUB-6: لا فشل صامت — رسالة عربية عند غياب المنتج أو الوصف"
    );
    assert(
      !/const productId = document\.getElementById\('publishProduct'\)\.value;\s*\n\s*if \(!productId \|\| !lastCopy\) return;/.test(dashSrc),
      "PUB-7: العودة الصامتة القديمة بـpublishToSalla أُزيلت"
    );
  }
}

main()
  .then(() => done())
  .catch((e) => {
    console.error("❌ Tests threw an exception:");
    console.error(e);
    process.exit(1);
  });

  // ── فجوة الهجرة: عمود جديد لا يُسقط ميزة قائمة (2026-09-10) ──────────
  {
    const { withVariantsFallback, VCOL, __resetVariantsFallback } =
      await import("../../functions/_lib/domain/migrationGap.js");

    __resetVariantsFallback();
    assert(VCOL(true) === ", variants" && VCOL(false) === "", "GAP-1: جزء العمود يظهر أو يختفي حسب توفّره");

    // أول نداء يفشل بعمود مفقود ⇒ يُعاد بلا العمود، ولا يُرمى للمستدعي.
    const seen = [];
    const out = await withVariantsFallback(async (v) => {
      seen.push(v);
      if (v) throw new Error("D1_ERROR: no such column: variants at offset 42");
      return "ok";
    });
    assert(out === "ok" && seen.join(",") === "true,false", `GAP-2: فشل العمود المفقود يُعاد بلا العمود (${seen})`);

    // بعدها لا محاولة ثانية بالعمود — لا فشل متكرر لكل طلب.
    const seen2 = [];
    await withVariantsFallback(async (v) => { seen2.push(v); return 1; });
    assert(seen2.join(",") === "false", "GAP-3: بعد أول فشل يُسقط العمود لبقية عمر الـWorker");

    // أخطاء أخرى تُرمى كما هي — لا ابتلاع لخطأ حقيقي.
    __resetVariantsFallback();
    let threw = null;
    try {
      await withVariantsFallback(async () => { throw new Error("D1_ERROR: database is locked"); });
    } catch (e) { threw = e.message; }
    assert(/database is locked/.test(threw || ""), "GAP-4: خطأ غير متعلق بالعمود يُرمى ولا يُبتلع");

    // القراءة والكتابة كلاهما محميّان.
    const { readFileSync } = await import("node:fs");
    const cat = readFileSync(new URL("../../functions/_lib/domain/catalog.js", import.meta.url), "utf8");
    assert(
      (cat.match(/withVariantsFallback/g) || []).length >= 3 && /VCOL\(v\)/.test(cat),
      "GAP-5: القراءة والكتابة بالكتالوج تمرّان بالحارس"
    );
  }

  // ── أحداث منتجات سلة: الكتالوج يتحدّث بلا ضغطة (2026-09-10) ──────────
  {
    const { handleProductEvent } = await import("../../functions/_lib/domain/sallaProductEvents.js");
    const { upsertCatalogProduct, deleteCatalogProduct } =
      await import("../../functions/_lib/domain/catalogProduct.js");

    const calls = [];
    const env = {
      DB: {
        prepare: (q) => ({
          bind: (...b) => { calls.push({ q: q.replace(/\s+/g, " ").trim(), b }); return { run: async () => ({ meta: { changes: 1 } }) }; }
        })
      }
    };
    const product = { id: 991, sku: "SKU-1", name: "فستان", price: { amount: 149, currency: "SAR" }, description: "وصف" };

    calls.length = 0;
    const up = await handleProductEvent(env, { merchantId: "m_1", event: "product.created", data: product });
    assert(
      up.handled === true && calls.length === 1 && /INSERT INTO store_products/.test(calls[0].q) &&
        calls[0].b[0] === "m_1" && calls[0].b[1] === "SKU-1",
      "PEV-1: إنشاء منتج يُكتب بالكتالوج مباشرة من الحمولة"
    );
    // صفر نداء لسلة: الحمولة تكفي، فلا استهلاك من حدّ الطلب/الثانية.
    assert(
      !/api\.salla\.dev/.test(JSON.stringify(calls)),
      "PEV-2: لا نداء لسلة — الحمولة تحمل المنتج كاملاً"
    );

    calls.length = 0;
    await handleProductEvent(env, { merchantId: "m_1", event: "product.updated", data: product });
    assert(/ON CONFLICT\(merchant_id, sku\) DO UPDATE/.test(calls[0].q), "PEV-3: التحديث يكتب فوق الصف نفسه لا يكرّره");
    // «التراجع» يبقى صادقاً: الأصل يُكتب مرة واحدة.
    assert(
      /original_description = COALESCE\(store_products\.original_description/.test(calls[0].q),
      "PEV-4: الوصف الأصلي محفوظ — التراجع بعد نشر هالة يبقى ممكناً"
    );

    calls.length = 0;
    const del = await handleProductEvent(env, { merchantId: "m_1", event: "product.deleted", data: { id: 991, sku: "SKU-1" } });
    assert(
      del.handled === true && /DELETE FROM store_products WHERE merchant_id = \? AND sku = \?/.test(calls[0].q) &&
        calls[0].b[0] === "m_1",
      "PEV-5: الحذف مقيَّد بالتاجر — SKU ليس فريداً بين المتاجر"
    );

    // حمولة بلا sku: يسقط بهدوء لا برمي (المفتاح الأساسي يتطلبه).
    calls.length = 0;
    const noSku = await handleProductEvent(env, { merchantId: "m_1", event: "product.created", data: { id: 5, name: "بلا رمز" } });
    assert(noSku.upserted === false && calls.length === 0, "PEV-6: منتج بلا SKU لا يُدرَج ولا يرمي");

    // الفشل يُسجَّل ولا يُسقط الويبهوك.
    const badEnv = { DB: { prepare: () => { throw new Error("D1 down"); } } };
    const failed = await handleProductEvent(badEnv, { merchantId: "m_1", event: "product.updated", data: product });
    assert(failed.handled === false && failed.error === true, "PEV-7: فشل الكتابة لا يُسقط الويبهوك");

    assert(
      (await handleProductEvent(env, {})).handled === false,
      "PEV-8: بلا تاجر أو حمولة لا عمل ولا رمي"
    );

    // موصول فعلاً بمعالج الأحداث.
    const { readFileSync } = await import("node:fs");
    const dom = readFileSync(new URL("../../functions/_lib/domain/salla.js", import.meta.url), "utf8");
    assert(
      /case "product\.created":/.test(dom) && /case "product\.updated":/.test(dom) &&
        /case "product\.deleted":/.test(dom) && /handleProductEvent\(env, \{ merchantId, event, data \}\)/.test(dom),
      "PEV-9: الأحداث الثلاثة موصولة بمعالج سلة"
    );
  }

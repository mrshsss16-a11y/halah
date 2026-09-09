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
    // بعد التقسيم public/js/dashboard/catalog.js يستخدم اقتباساً مزدوجاً — نفس المعنى.
    assert(
      /pName["']\)\.value = it\.name/.test(useFn) &&
        /pImageUrl["']\)\.value = it\.imageUrl/.test(useFn) &&
        /pExistingDescription["']\)\.value = it\.currentDescription/.test(useFn) &&
        /generateCopy\(\);/.test(useFn.slice(0, 1400)),
      "CATUI-7: الضغط على بطاقة يعبّي الحقول (اسم/صورة/وصف حالي) ويشغّل التوليد فوراً"
    );
    assert(
      /catalogEmpty[\s\S]{0,400}ما سحبنا منتجاتك بعد/.test(dashSrc),
      "CATUI-8: حالة فارغة صريحة توجّه للسحب"
    );
    // pImageUrl خرج من <details> — لم يعد حقلاً يدوياً مخفياً.
    const detailsBlocks = dashSrc.match(/<details[\s\S]*?<\/details>/g) || [];
    assert(
      detailsBlocks.every((b) => !b.includes('id="pImageUrl"')),
      "CATUI-9: حقل الصورة ظاهر بالمسار الأساسي لا مخفياً داخل <details>"
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
          /escHtml\(/.test(s) || /^\$\{(img|badge|skuBadge|it\.imageUrl \? (['"])hidden\2 : \2\2)\}$/.test(s)
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

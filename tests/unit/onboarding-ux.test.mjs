import { createRunner, readComposedPage } from "../_helpers.mjs";

const { assert, done } = createRunner("onboarding-ux");

async function main() {
  // ── تجربة أول تاجر — مرصود بثلاثة وكلاء وأُصلح (2026-09-09) ──────────
  {
    const { readFileSync } = await import("node:fs");
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const dash = await readComposedPage("dashboard");
    const listSrc = read("../../functions/api/store/catalog/list.js");
    const hookSrc = read("../../functions/api/webhooks/salla.js");

    // #1 التبويب الافتراضي «منتجاتي» — لا نموذج كتابة يدوية أول ما يفتح التاجر.
    assert(
      /id="sectionCatalog" class="space-y-5"/.test(dash) && /id="sectionStudio" class="hidden space-y-5"/.test(dash) &&
        /id="navTabCatalog"[^>]*class="tab-on/.test(dash),
      "UX-1: التبويب الافتراضي «منتجاتي» لا الاستوديو"
    );
    // #2/#3/#7 الحالة الفارغة ثلاث حالات صادقة من أعلام الخادم.
    assert(
      /syncing: Boolean\(activeSync\)/.test(listSrc) && /synced: Boolean\(syncState\.syncedAt\)/.test(listSrc),
      "UX-2: list.js يرجّع syncing/synced لا total فقط"
    );
    assert(
      /جاري سحب منتجاتك من سلة…/.test(dash) && /متجرك مربوط، لكن ما لقينا منتجات/.test(dash) &&
        /ما سحبنا منتجاتك بعد/.test(dash),
      "UX-3: ثلاث رسائل فراغ مختلفة (جارٍ / سُحب ولم يجد / لم يبدأ)"
    );
    assert(
      !/env\.DB\.prepare/.test(listSrc),
      "UX-4: list.js لا يلمس D1 مباشرة (CATUI-4 محفوظ)"
    );
    // #6 تحديث ذاتي أثناء السحب بالخلفية.
    assert(
      /function scheduleCatalogRefresh/.test(dash) && /if \(data\.syncing && count > 0\) scheduleCatalogRefresh\(\)/.test(dash),
      "UX-5: بقية الصفحات تظهر بلا إعادة تحميل يدوية"
    );
    // #4 صندوق النشر لا يختفي بصمت.
    assert(
      /هذا المنتج بلا معرّف سلة/.test(dash) && /box\.classList\.remove\((['"])hidden\1\)/.test(dash),
      "UX-6: منتج بلا productId ⇒ صندوق النشر ظاهر بسبب صريح"
    );
    // #10 زر الجملة معطّل بلا منتجات — lastCatalogTotal صار S.lastCatalogTotal بعد التقسيم.
    assert(
      /function setBulkGenerateEnabled/.test(dash) && /setBulkGenerateEnabled\(S\.lastCatalogTotal > 0\)/.test(dash),
      "UX-7: زر «ولّد أوصاف منتجاتي» معطّل حتى يُسحب شيء"
    );
    // #11 زر السحب بعد النجاح — syncCooldownTimer صار S.syncCooldownTimer بعد التقسيم.
    assert(
      /txt\.innerText = (['"])تحديث المنتجات\1/.test(dash) && /S\.syncCooldownTimer = setTimeout\(\(\) => \{ btn\.disabled = false; S\.syncCooldownTimer = null; \}, 60000\)/.test(dash),
      "UX-8: بعد السحب الزر يصير «تحديث» ويهدأ ٦٠ ثانية"
    );
    // #12 تنبيه إكمال الحساب يشير لزر موجود.
    assert(
      !/أعد الضغط على الزر اللي كنت تحاول تستخدمه/.test(dash) && /اضغط «اكتب الوصف الآن» لتوليد الوصف/.test(dash),
      "UX-9: تنبيه إكمال الحساب يوجّه لزر التوليد الفعلي"
    );
    // #9 بلا صورة يُقال صراحةً.
    assert(
      /usedImage: Boolean\(parsed\.usedImage\)/.test(read("../../functions/api/copy.js")) && /id="copyNoImageNote"/.test(dash),
      "UX-10: الوصف بلا صورة يحمل ملاحظة ظاهرة لا صمتاً"
    );
    // الهوية بالرأس: اسم المتجر + البريد + عدد المنتجات، بلا تخزين محلي.
    assert(
      /id="navIdentityLine"/.test(dash) && /function renderIdentityLine/.test(dash) &&
        !/localStorage\.setItem\('[^']*email/.test(dash),
      "UX-11: هوية المتجر والحساب ظاهرة دائماً بالرأس، بالذاكرة فقط"
    );
    assert(
      /pageshow/.test(dash) && /e\.persisted\) location\.reload\(\)/.test(dash),
      "UX-12: رجوع المتصفح لا يعرض DOM حساب سابق"
    );
    // اسم المتجر يُجلب من Store Info (الحمولة لا تحمله). المرحلة ٤: بالمجال.
    const eventSrc2 = read("../../functions/_lib/domain/salla.js");
    assert(
      /getStoreInfo\(await getValidSallaToken\(env, merchantId\)\)/.test(eventSrc2) && /SALLA_STORE_INFO_FAILED/.test(eventSrc2) &&
        /export async function getStoreInfo/.test(read("../../functions/_lib/integrations/salla.js")),
      "UX-13: store_name يُجلب من /store/info بعد التوكن، وفشله لا يوقف الويبهوك"
    );

    // ── الفشل الصامت (وكيل ٢) ──
    assert(
      /ما قدرنا نفتح لوحتك من داخل سلة/.test(dash),
      "SILENT-1: فشل جلسة إطار سلة يقول كلمة قبل الإغلاق"
    );
    assert(
      /خطأ خادم بلا حقل error كان يُعرض "تم الحفظ ✅"/.test(dash) && /if \(!res\.ok \|\| data\?\.error\) \{\s*showMsg\((['"])agentFeedback\1/.test(dash),
      "SILENT-2: حفظ إعدادات الوكيل لا يعرض نجاحاً كاذباً"
    );
    assert(
      /const emptyResult = !data \|\| \(!data\.copywriting && !data\.result\)/.test(dash),
      "SILENT-3: توليد فارغ لا يمرّ كنجاح"
    );
    assert(
      /pollFailures >= 3/.test(dash) && /توقّف تتبّع التقدّم مؤقتاً/.test(dash),
      "SILENT-4: شريط الجملة لا يتجمّد بصمت"
    );
    assert(
      /لا تحفظ شي الحين لين يرجع الاتصال/.test(dash),
      "SILENT-5: فشل تحميل الإعدادات يحذّر من الكتابة فوق الأصل"
    );
    assert(
      /هذا لا يعني أن الربط انقطع/.test(dash),
      "SILENT-6: خطأ خادم بحالة المتجر لا يُعرض كـ«غير مرتبط»"
    );
    assert(
      /ADD COLUMN catalog_synced_at/.test(read("../../migrations/0026_catalog_synced_at.sql")),
      "UX-14: هجرة 0026 تضيف catalog_synced_at"
    );
  }

  // ── مراجعة Opus على إصلاحات التجربة: ٣ حمراء أُغلقت (2026-09-09) ──
  {
    const { readFileSync } = await import("node:fs");
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const dash = await readComposedPage("dashboard");
    // main.js يستخدم اقتباساً مزدوجاً بعد التقسيم — نفس الحدث.
    const bootMatch = dash.match(/document\.addEventListener\((['"])DOMContentLoaded\1/);
    const boot = dash.slice(bootMatch ? bootMatch.index : 0);
    assert(
      /loadCatalog\(0\);/.test(boot) && /setBulkGenerateEnabled\(false\);/.test(boot),
      "REV-1: التبويب الافتراضي يُحمَّل عند الفتح (كان قسماً فاضياً بلا تحميل)"
    );
    assert(
      /grid\.appendChild\(catalogCard\(it, key\)\)/.test(dash) && /card\.dataset\.sku = key;/.test(dash) &&
        /useCatalogItem\(key\)/.test(dash) && !/useCatalogItem\(it\.sku\)/.test(dash),
      "REV-2: بطاقة بلا SKU تُفتح بنفس مفتاحها — لا نقرة ميتة"
    );
    assert(
      /line\.innerText = (['"])هذا المنتج بلا معرّف سلة[^]*?line\.classList\.remove\((['"])hidden\2\)/.test(dash),
      "REV-3: سبب «بلا معرّف سلة» يظهر فعلاً لا يبقى مخفياً"
    );
    // catalogNextOffset/catalogRefreshTimer صارا S.catalogNextOffset/S.catalogRefreshTimer بعد التقسيم.
    assert(
      /if \(S\.catalogNextOffset > 0\) return;/.test(dash) && /clearTimeout\(S\.catalogRefreshTimer\)/.test(dash),
      "REV-4: التحديث الذاتي لا يمسح صفحات «عرض المزيد» ولا يتوازى مع تحميل يدوي"
    );
    assert(
      !/'متجرك على سلة'/.test(dash),
      "REV-5: غياب اسم المتجر لا يدّعي ربطاً بسلة"
    );
    assert(
      /settings\\\.read/.test(read("../../functions/_lib/domain/salla.js")),
      "REV-6: /store/info يُستدعى فقط إن مُنح settings.read"
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

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

    // #1 تبويب واحد افتراضي «منتجاتي ووصفها» — الاستوديو دُمج داخله 2026-09-10،
    // فلم يعد قسماً مستقلاً ولا تبويباً يقفز إليه الاختيار.
    assert(
      /id="sectionCatalog" class="space-y-5"/.test(dash) &&
        !/id="sectionStudio"/.test(dash) && !/navTabStudio/.test(dash) &&
        /id="navTabCatalog"[^>]*class="tab-on/.test(dash),
      "UX-1: تبويب واحد «منتجاتي ووصفها» — لا قسم استوديو منفصل"
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
    // SILENT-2/SILENT-5 كانتا تحرسان صدق رسائل «إعدادات الوكيل». التبويب
    // أُزيل (2026-09-10) فلا سطح لهما؛ يعودان مع الميزة من git لا يُعاد
    // كتابتهما من الصفر. ما يُحرس اليوم: ألا تبقى واجهة تَعِد بردٍّ معطَّل.
    assert(
      !/id="sectionAgent"/.test(dash) && !/id="chatLog"/.test(dash),
      "SILENT-2/5 (منقولة): لا تبويب وكيل ولا سجل محادثة بالواجهة"
    );
    // شريط الحصة تبع الإزالة: عدّاد «رسائل الشهر» كان يعرض ٣٠٠ لحصة لم يبقَ
    // لها سطح صرف، والعنوان الفرعي يعد بـ«وكيل خدمة عملاء». كلاهما وعدٌ بما
    // لا يوجد. الصور تُصرف فعلاً — كل توليد من صورة يستهلك واحدة.
    // تُجرَّد تعليقات HTML أولاً: الحارس يفحص ما **يراه التاجر**، لا نثر
    // التعليق الذي يشرح لماذا أُزيل العدّاد (وهو يذكر اسمه بطبيعته).
    const dashVisible = dash.replace(/<!--[\s\S]*?-->/g, "");
    assert(
      !/kpiUsageMsg/.test(dashVisible) && !/رسائل الشهر/.test(dashVisible),
      "KPI-1: لا عدّاد رسائل — حصة بلا سطح صرف لا تُعرض"
    );
    // KPI-2 قُلب 2026-09-10: «صور الشهر» كان خطأً — دلو image يُستهلك بتوليد
    // الصور من الأدمن فقط، لا بتحليل صورة المنتج، فكان عدّاداً لا يتحرك أبداً.
    assert(
      !/kpiUsageImg/.test(dashVisible) && !/صور الشهر/.test(dashVisible),
      "KPI-2: لا عدّاد صور — دلو image لا يُصرف من لوحة التاجر"
    );
    assert(
      !/وكيل خدمة عملاء سعودي/.test(dash),
      "KPI-3: العنوان الفرعي لا يعد بوكيل خدمة عملاء بعد إزالة تبويبه"
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

  // ── دمج «منتجاتي» مع «وصف المنتجات» — أقل نقرات وبلا تشتيت (2026-09-10) ──
  {
    const { readFileSync } = await import("node:fs");
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const dashM = await readComposedPage("dashboard");
    const cat = read("../../public/js/dashboard/catalog.js");
    const stu = read("../../public/js/dashboard/studio.js");
    const tabs = read("../../public/js/dashboard/tabs.js");

    assert(
      !/navTabStudio/.test(dashM) && /منتجاتي ووصفها/.test(dashM),
      "MERGE-1: تبويب «وصف المنتجات» أُزيل وصار «منتجاتي ووصفها»"
    );
    // اللوحة داخل قسم المنتجات نفسه — الشبكة تبقى ظاهرة.
    const section = dashM.slice(dashM.indexOf('id="sectionCatalog"'), dashM.indexOf('id="sectionAgent"'));
    assert(
      section.includes('id="copyResult"') && section.includes('id="catalogGrid"') &&
        section.includes('id="reviewCard"'),
      "MERGE-2: الشبكة ولوحة الوصف وطابور المراجعة بقسم واحد"
    );
    // لا قفز تبويب عند اختيار منتج.
    assert(
      !/switchTab\("studio"\)/.test(cat) && /openCopyPanel\(it\)/.test(cat),
      "MERGE-3: اختيار منتج يفتح اللوحة بمكانها بلا تبديل تبويب"
    );
    // حالة انتظار مرئية فور الضغط — كان التوليد يبدو "بالخلفية".
    assert(
      /id="copyPending"/.test(dashM) && /copyPendingName/.test(cat) &&
        /getElementById\("copyPending"\)\?\.classList\.add\("hidden"\)/.test(stu),
      "MERGE-4: حالة انتظار باسم المنتج تظهر فوراً وتُخفى عند النتيجة أو الخطأ"
    );
    assert(
      /panel\.scrollIntoView/.test(stu) && /pending\.scrollIntoView/.test(cat),
      "MERGE-5: النتيجة تُمرَّر لمجال الرؤية — لا بحث عنها بالصفحة"
    );
    // رأس اللوحة يعرّف المنتج: صورة واسم.
    assert(
      /id="copyResultImg"/.test(dashM) && /id="copyResultName"/.test(dashM) &&
        /copyResultImg/.test(cat),
      "MERGE-6: رأس اللوحة يعرض صورة المنتج واسمه"
    );
    assert(
      /closeCopyPanel/.test(dashM) && /export function closeCopyPanel/.test(cat),
      "MERGE-7: إغلاق اللوحة يرجّع للشبكة بلا إعادة تحميل"
    );
    // نداء قديم لا يُخفي كل شيء.
    assert(
      /if \(tab === "studio"\) tab = "catalog";/.test(tabs) &&
        /const tabs = \["catalog", "store"\]/.test(tabs),
      "MERGE-8: switchTab(\"studio\") القديم يُحوَّل لا يكسر"
    );
    // المراجعة تُحمَّل مع نفس التبويب.
    assert(
      /if \(tab === "catalog"\) \{[\s\S]*?loadReview\("pending"\)/.test(tabs),
      "MERGE-9: طابور المراجعة يُحمَّل مع «منتجاتي»"
    );
    // الإدخال اليدوي (منتج مو بسلة) أُزيل — publishToSalla يرفض بلا productId
    // حقيقي من الكتالوج فلا وجهة نشر له. النموذج نفسه باقٍ مخفياً، تملأه
    // useCatalogItem برمجياً فقط بعد اختيار منتج حقيقي.
    assert(
      /id="studioManual"[^>]*\bhidden\b/.test(dashM) && !/أو اكتب منتجاً يدوياً/.test(dashM) &&
        /id="pName"/.test(dashM),
      "MERGE-10: الإدخال اليدوي أُزيل، النموذج باقٍ مخفياً للمسار الحقيقي فقط"
    );
  }

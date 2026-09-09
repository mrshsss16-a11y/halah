// اختبارات دفعة ج (تجربة التاجر) — U1..U5، U7..U12. أسلوب tests/api.test.mjs
// وtests/ops-wave.test.mjs: دوال fake بدل موك خارجي، assert بسيط، PASS/FAIL.
// لا يلمس tests/api.test.mjs.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { findCatalogBySallaProductId, markPublished } from "../../functions/_lib/domain/catalog.js";
import { readComposedPage } from "../_helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

// dashboard.html/admin.html صارا قالبين فارغين بعد التقسيم إلى partials/ +
// public/js/** (docs/ARCHITECTURE.md، تقسيم 2026-09-09) — أي فحص "شكل الكود"
// عليهما يحتاج الصفحة المركَّبة (dist + partials) لا الجذر وحده.
let __composedCache = {};
async function readSrc(rel) {
  if (rel === "dashboard.html" || rel === "admin.html") {
    const name = rel.replace(".html", "");
    if (!__composedCache[name]) __composedCache[name] = await readComposedPage(name);
    return __composedCache[name];
  }
  return readFileSync(join(ROOT, rel), "utf8");
}

function fakeDb(rows = {}) {
  return {
    prepare(sql) {
      return {
        _sql: sql,
        _binds: [],
        bind(...args) {
          this._binds = args;
          return this;
        },
        first: async function () {
          if (this._sql.includes("SELECT sku, salla_product_id, original_description")) {
            return rows.catalogRow || null;
          }
          return null;
        },
        run: async function () {
          rows.lastUpdate = { sql: this._sql, binds: this._binds };
          return { meta: { changes: 1 } };
        }
      };
    }
  };
}

async function runTests() {
  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${message}`);
    }
  }

  console.log("Starting ux-wave tests...\n");

  // ---- U1: auth/salla/callback.js يُنشئ جلسة ويحوّل 302 لا JSON خام ----
  {
    // المرحلة ٤: النقطة تنسيق فقط — المبادلة وحفظ التوكن بـdomain/salla.js.
    const src = await readSrc("functions/api/auth/salla/callback.js");
    const domainSrc = await readSrc("functions/_lib/domain/salla.js");
    assert(src.includes("createSessionToken") && src.includes("sessionCookieHeader"), "U1: callback.js يستدعي createSessionToken/sessionCookieHeader");
    assert(src.includes("status: 302") && src.includes("/dashboard?connected=1"), "U1: callback.js يحوّل 302 إلى /dashboard?connected=1 عند النجاح");
    assert(domainSrc.includes("upsertMerchantFromSalla"), "U1: مسار الربط يستخدم upsertMerchantFromSalla بدل معرّف سلة الخام كـmerchantId داخلي");
    assert(src.includes('"تعذر إكمال الربط') && src.includes('"content-type": "application/json"'), "U1: رسائل الخطأ تبقى JSON عربياً كما كانت");
  }
  {
    const src = await readSrc("dashboard.html");
    assert(src.includes("connectedBanner"), "U1: dashboard.html فيه شريط ترحيب connectedBanner");
    // بعد التقسيم public/js/dashboard/main.js يستخدم اقتباساً مزدوجاً
    // (get("connected") === "1") — نفس المعنى، تحوّل أسلوب فقط أثناء نقل الكود لوحدة.
    assert(/get\((['"])connected\1\)\s*===\s*(['"])1\2/.test(src), "U1: dashboard.html يقرأ ?connected=1 من الرابط");
  }

  // ---- U2/U3: login.html ----
  {
    const src = await readSrc("login.html");
    assert(!src.includes("data.otpCode"), "U2: login.html لا يعرض data.otpCode أبداً");
    assert(src.includes("إن كان البريد مسجلاً وصلك الرمز على واتساب"), "U2: رسالة نجاح صادقة بدل عرض الرمز");
    assert(!/sleek-btn-black/.test(src), "U3: login.html لا يستخدم صنف sleek-btn-black غير المعرَّف");
    assert(src.includes(".wire-btn"), "U3: login.html يعرّف صنف wire-btn البديل");
  }

  // ---- U3: index.html ادعاءات صادقة ----
  {
    const src = await readSrc("index.html");
    assert(!/سلات؟ متروكة/.test(src) || !/استرداد/.test(src), "U3: index.html لا يعد باسترداد السلات المتروكة (مؤرشفة)");
    assert(!/70%|٧٠٪/.test(src), "U3: index.html لا يدّعي 70% بلا مصدر");
    assert(!/AES-256/.test(src), "U3: index.html لا يدّعي AES-256");
    assert(!/ربط رسمي مع سلة وزد/.test(src), "U3: index.html لا يدّعي ربط رسمي مع زد (مؤرشف)");
    assert(!/مجاني 100% وبدون أي تكلفة/.test(src), "U3: index.html لا يدّعي 'مجاني 100% وبدون أي تكلفة' المبهم");
    assert(src.includes("٦٠") && src.includes("٣٠٠"), "U3: index.html يذكر حدود الباقة المجانية الحقيقية (٦٠ وصفاً/٣٠٠ رسالة)");
  }

  // ---- U4: publish.js — revertAvailable صادق + catalog.findCatalogBySallaProductId ----
  {
    const src = await readSrc("functions/api/store/publish.js");
    assert(src.includes("findCatalogBySallaProductId"), "U4: publish.js يستدعي findCatalogBySallaProductId");
    assert(src.includes("markPublished"), "U4: publish.js يستدعي markPublished بعد نجاح النشر");
    assert(src.includes("revertAvailable"), "U4: publish.js يعيد revertAvailable بالاستجابة");
  }

  // findCatalogBySallaProductId: يرجع null إن لم يوجد صف (بدل رمي أو تلفيق بيانات)
  {
    const env = { DB: fakeDb({ catalogRow: null }) };
    const row = await findCatalogBySallaProductId(env, { merchantId: "m1", sallaProductId: "999" });
    assert(row === null, "U4: findCatalogBySallaProductId يرجع null لمنتج بلا صف كتالوج (رفع يدوي)");
  }
  {
    const env = { DB: fakeDb({ catalogRow: { sku: "SKU1", salla_product_id: "123", original_description: "أصلي" } }) };
    const row = await findCatalogBySallaProductId(env, { merchantId: "m1", sallaProductId: "123" });
    assert(row && row.sku === "SKU1", "U4: findCatalogBySallaProductId يرجع صف الكتالوج المطابق لمعرّف منتج سلة");
  }
  {
    const rows = {};
    const env = { DB: fakeDb(rows) };
    await markPublished(env, { merchantId: "m1", sku: "SKU1", description: "وصف جديد" });
    assert(rows.lastUpdate?.sql.includes("hala_published_at = datetime('now')"), "U4: markPublished يحدّث hala_published_at عند وسم النشر");
  }

  // ---- dashboard.html: بطاقة المنتج + رابط تراجع مشروط بـrevertAvailable ----
  {
    const src = await readSrc("dashboard.html");
    assert(src.includes("markCatalogCardPublished"), "U4/U8: dashboard.html يحدّث بطاقة «منتجاتي» بعد النشر المفرد");
    assert(/revertAvailable\s*&&\s*sku/.test(src), "U4: زر التراجع لا يظهر إلا إن أكد الخادم revertAvailable");
  }

  // ---- U7: decide.js رسالة التراجع تذكر بقاء حقول السيو بصدق ----
  {
    const src = await readSrc("functions/_lib/domain/publish.js");
    assert(src.includes("عنوان ووصف البحث اللذان أضافتهما هالة يبقيان"), "U7: رسالة التراجع تقول إن حقول السيو تبقى");
    assert(src.includes("عدّلهما من لوحة سلة"), "U7: رسالة التراجع توجّه التاجر لتعديلها من سلة");
  }

  // ---- U5: تبويب الوكيل — صدق الحالة + بطاقة تركيب الودجت الفعلية ----
  {
    const dash = await readSrc("dashboard.html");
    const widget = await readSrc("widget.js");
    assert(widget.includes('getAttribute("data-store-id")'), "U5: widget.js يقرأ data-store-id فعلاً (شرط عرض سطر التركيب)");
    assert(dash.includes("widgetSnippet"), "U5: dashboard.html فيه بطاقة كود تركيب الودجت (widgetSnippet)");
    assert(dash.includes('data-store-id="'), "U5: سطر التركيب المعروض يستخدم data-store-id الحقيقي لا data-store الوهمي");
    assert(dash.includes("يحتاجان اعتماد ميتا وتطوير إضافي"), "U5: صياغة صادقة أن ربط واتساب بضغطة وتركيب الودجت الآلي قريباً لا الآن");
  }

  // ---- U9: شريط الجملة يذكر مدة بدء المعالجة ----
  {
    const src = await readSrc("dashboard.html");
    assert(src.includes("تبدأ المعالجة خلال ~١٠ دقائق"), "U9: شريط الجملة يعرض 'تبدأ المعالجة خلال ~١٠ دقائق'");
    assert(src.includes("كل ١٠ دقائق دفعة"), "U9: شريط الجملة يوضح أن الدفعة كل ١٠ دقائق");
  }

  // ---- U10: لا alert() متبقٍ، شريط داخلي بديل ----
  {
    const src = await readSrc("dashboard.html");
    assert(!/\balert\(/.test(src), "U10: dashboard.html بلا استدعاءات alert() متبقية");
    const shared = await readSrc("public/js/shared.js");
    assert(shared.includes("function showToast") && src.includes("/js/shared.js"), "U10: يوجد شريط إشعار داخلي showToast (بالملف المشترك public/js/shared.js) بديل عن alert()");
  }

  // ---- U11: showMsg يقبل نوعاً بألوان مختلفة ----
  {
    const src = await readSrc("dashboard.html");
    const shared = await readSrc("public/js/shared.js");
    assert(/function showMsg\(id, text, type\)/.test(shared), "U11: showMsg تقبل معامل type (بالملف المشترك)");
    assert(shared.includes("bg-rose-50") && shared.includes("bg-emerald-50"), "U11: showMsg يفرّق ألوان الخطأ/النجاح");
    // بعد التقسيم public/js/dashboard/review.js يستخدم اقتباساً مزدوجاً — نفس المعنى.
    assert(/showMsg\((['"])reviewFeedback\1,[\s\S]{0,120}(['"])error\2\)/.test(src), "U11: نداء showMsg بنوع 'error' مطبّق على أحد أهم المواضع");
  }

  // ---- U12: إصلاحات الجوال الثلاثة + شارة بلا SKU + data-attribute للتراجع ----
  {
    const src = await readSrc("dashboard.html");
    assert(!/px-4\.5/.test(src), "U12: لا يوجد صنف Tailwind غير صالح px-4.5");
    assert(src.includes("truncate") && src.includes("navStoreTitle"), "U12: اسم المتجر بالشريط العلوي يُقصّ (truncate) بالجوال");
    assert(/flex flex-wrap items-center gap-3/.test(src), "U12: صف مؤشرات KPI يتحمّل flex-wrap بالجوال");
    assert(src.includes("بلا SKU — لا يدخل التوليد الجماعي"), "U12: شارة 'بلا SKU' تظهر على بطاقة المنتج بلا SKU");
    assert(src.includes("data-revert-sku=") && src.includes("this.dataset.revertSku"), "U12: SKU يمرّ عبر data-attribute لا onclick مهرَّب بـHTML");
    assert(!/onclick="revertReview\('\$\{escHtml/.test(src), "U12: لا يوجد بعد الآن SKU مهرَّب مباشرة داخل onclick");
  }

  console.log(`\n${passed}/${total} tests passed.`);
  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});

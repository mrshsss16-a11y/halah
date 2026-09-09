import { createRunner, readComposedPage } from "../_helpers.mjs";

const { assert, done } = createRunner("bulk");

async function main() {
  // ── اختيار متعدد من «منتجاتي» ثم توليد للمحدد (2026-09-09) ──────────
  {
    const { readFileSync } = await import("node:fs");
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const { selectCatalogBySkus } = await import("../../functions/_lib/domain/catalog.js");
    const dash = await readComposedPage("dashboard");
    const genSrc = read("../../functions/api/store/bulk/generate.js");

    // العزل: قائمة الـSKU مدخل عميل — الاستعلام يقيّد بالتاجر دائماً.
    const seen = [];
    const env = {
      DB: {
        prepare: (q) => ({
          bind: (...b) => { seen.push({ q: q.replace(/\s+/g, " ").trim(), b }); return { all: async () => ({ results: [{ sku: b[2] }, { sku: b[1] }] }) }; }
        })
      }
    };
    const out = await selectCatalogBySkus(env, { merchantId: "m_1", skus: ["A", "B"] });
    assert(
      seen.length === 1 && /WHERE merchant_id = \? AND sku IN \(\?,\?\)/.test(seen[0].q) && seen[0].b[0] === "m_1",
      "PICK-1: اختيار بالـSKU مقيَّد بـmerchant_id (مدخل عميل)"
    );
    assert(
      out.map((r) => r.sku).join(",") === "A,B",
      "PICK-2: الترتيب يتبع اختيار التاجر لا ترتيب القاعدة"
    );
    assert(
      (await selectCatalogBySkus(env, { merchantId: "m_1", skus: [] })).length === 0 &&
        (await selectCatalogBySkus(env, { merchantId: "m_1" })).length === 0,
      "PICK-3: قائمة فارغة لا تستعلم ولا ترمي"
    );
    let threw = false;
    try { await selectCatalogBySkus(env, { merchantId: "", skus: ["A"] }); } catch (e) { threw = true; }
    assert(threw, "PICK-4: بلا معرّف تاجر يُرفض — لا استعلام عابر");
    // تكرار وقصّ: ٦٠٠ SKU ⇒ دفعات ٥٠، وسقف ٥٠٠.
    seen.length = 0;
    const many = Array.from({ length: 600 }, (_, i) => "S" + i);
    await selectCatalogBySkus(env, { merchantId: "m_1", skus: many });
    assert(seen.length === 10 && seen.every((c) => c.b[0] === "m_1"), `PICK-5: يقصّ عند ٥٠٠ ويقسّم دفعات ٥٠ (دفعات: ${seen.length})`);

    // الخادم: قائمة صريحة تتقدّم على ترتيب الأولوية.
    assert(
      /selectCatalogBySkus\(env, \{ merchantId, skus: chosenSkus \}\)/.test(genSrc) &&
        /: await listPriorityCatalog\(env, \{ merchantId, limit: requested \}\)/.test(genSrc),
      "PICK-6: اختيار التاجر يتقدّم على الترتيب التلقائي، والتلقائي باقٍ"
    );
    assert(
      /SELECTION_NOT_FOUND/.test(genSrc),
      "PICK-7: SKU لا يخصّ التاجر ⇒ رسالة عربية لا وظيفة فارغة"
    );

    // الواجهة.
    assert(
      /id="catalogSelectBar"/.test(dash) && /(['"])catalog-pick /.test(dash) && /function generateSelectedCatalog/.test(dash),
      "PICK-8: شبكة «منتجاتي» فيها مربعات اختيار وزر توليد للمحدد"
    );
    assert(
      /if \(it\.sku\) \{/.test(dash),
      "PICK-9: منتج بلا SKU بلا مربع اختيار — لا وعد بما لا يُنفَّذ"
    );
    assert(
      /const wrap = document\.createElement\((['"])div\1\)/.test(dash) && !/card\.appendChild\(pick\)/.test(dash),
      "PICK-10: مربع الاختيار خارج زر البطاقة (زر داخل زر يكسر النقر)"
    );
    // بعد التقسيم النداء صار عبر postSoft("/api/store/bulk/generate", { skus, tone }, …)
    // بـpublic/js/dashboard/api.js بدل fetch مباشر بـdashboard.html — نفس الحمولة المُرسلة.
    assert(
      /postSoft\(\s*["'`]\/api\/store\/bulk\/generate["'`],\s*\{\s*skus,\s*tone\s*\}/.test(dash),
      "PICK-11: الواجهة ترسل قائمة الـSKU المحددة"
    );
    // catalogItems/selectedSkus صارت S.selectedSkus بحالة مشتركة state.js بعد التقسيم.
    assert(
      !/localStorage[^\n]*selectedSkus/.test(dash) && /selectedSkus:\s*new Set\(\)/.test(dash),
      "PICK-12: الاختيار بالذاكرة فقط — لا تخزين محلي لبيانات متجر"
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

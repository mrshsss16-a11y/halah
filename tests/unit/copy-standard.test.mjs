// معيار هالة (docs/COPY_STANDARD.md) — التغييران ١ و٢، 2026-09-13: نشر المواصفات، حفظ حقائق التاجر، عقد البرومبت.
import { createRunner } from "../_helpers.mjs";
import { preserveMerchantFacts } from "../../functions/_lib/domain/copyFacts.js";
import { buildSallaProductFields } from "../../functions/_lib/domain/sallaProductPayload.js";
import { copyCategoryFor } from "../../functions/_lib/ai/decisionQuestions.js";
import { buildSeoSystem } from "../../functions/_lib/ai/prompts/seo.js";

const { assert, done } = createRunner("copy-standard");
const page = (description, extra = {}) => ({ copywriting: { description, excerpt: "", highlights: [] }, seo: {}, faqs: [], specsTable: [], ...extra });

async function main() {
  {
    const p = page("عسل سدر جبلي بلون كهرماني، مناسب للإفطار.");
    const n = preserveMerchantFacts(p, { name: "عسل سدر جبلي", features: "الوزن: 500 جرام؛ المنشأ: اليمن؛ يُحفظ بعيداً عن الرطوبة" });
    const rows = p.specsTable.map((r) => `${r.key}: ${r.value}`).join(" | ");
    assert(n === 2 && /الوزن: 500 جرام/.test(rows) && /المنشأ: اليمن/.test(rows), `CS-1: وزن ومنشأ من بيانات التاجر غائبان عن الصفحة يُضافان للمواصفات بكلماته («${rows}»)`);
  }
  {
    const p = page("عسل سدر جبلي بوزن 500 جم من اليمن.");
    const n = preserveMerchantFacts(p, { name: "عسل سدر", features: "الوزن 500 جرام؛ المنشأ اليمن" });
    assert(n === 0, `CS-2: «500 جم» تطابق «500 جرام» (مرادفات الوحدة) — لا صف مكرر (${n})`);
  }
  {
    const p = page("قهوة سعودية شقراء بالهيل.");
    const n = preserveMerchantFacts(p, { name: "قهوة سعودية شقراء هرري 250 جم", features: "250 جم" });
    assert(n === 0, "CS-3: حقيقة في اسم المنتج ظاهرة للعميل — لا تُكرر في المواصفات");
  }
  {
    const p = page("ساعة سيكو 5 أوتوماتيك بمينا سوداء.");
    preserveMerchantFacts(p, { name: "ساعة سيكو 5", features: "السوار ستانلس ستيل، مقاس الإطار 37 ملم" });
    const rows = p.specsTable.map((r) => `${r.key}: ${r.value}`).join(" | ");
    assert(/ستانلس ستيل/.test(rows) && /37 ملم/.test(rows), `CS-4: خامة ومقاس من المزايا يُحفظان («${rows}»)`);
  }
  {
    const p = page("فستان سهرة كحلي بقصّة كلوش.");
    preserveMerchantFacts(p, { name: "فستان سهرة", variants: [{ name: "المقاس", values: ["XS", "S", "M", "L", "XL", "XXL", "XXXL"] }] });
    assert(p.specsTable.some((r) => r.key === "المقاس" && /XS، S، M/.test(r.value)), "CS-5: خيارات المقاس غير المذكورة تُضاف صفاً");
  }
  {
    const p = page("شاحن سريع بقدرة 65 واط بمنفذين.");
    const n = preserveMerchantFacts(p, { name: "شاحن", features: "القدرة 65W؛ منفذان USB-C" });
    assert(n === 0, `CS-6: «65W» تطابق «65 واط» (${n})`);
  }
  {
    const built = buildSallaProductFields({ description: "عسل سدر.", specsTable: [{ key: "الوزن", value: "500 جرام" }, { key: "<b>", value: "x" }] });
    assert(/<h3>المواصفات<\/h3><ul><li>الوزن: 500 جرام<\/li><li>&lt;b&gt;: x<\/li><\/ul>/.test(built.fields.description), "CS-7: المواصفات تُنشر في HTML الوصف ومهرَّبة");
  }
  assert(copyCategoryFor({ name: "قهوة سعودية شقراء هرري 250 جم" }) === "coffee" && copyCategoryFor({ name: "عسل سدر جبلي 500 جرام" }) === "honey"
    && copyCategoryFor({ name: "تمر سكري مفتل 3 كيلو" }) === "dates" && copyCategoryFor({ name: "شاحن سريع 65 واط" }) === "electronics"
    && copyCategoryFor({ name: "ساعة ذكية" }) === "electronics" && copyCategoryFor({ name: "ساعة سيكو 5" }) === "watches"
    && copyCategoryFor({ name: "دهن عود كمبودي 3 تولة" }) === "perfumes" && copyCategoryFor({ name: "منتج", category: "عبايات" }) === "apparel"
    && copyCategoryFor({ name: "شيء غريب" }) === "general", "CS-8: فئة المعيار من الاسم ثم التصنيف (قهوة، عسل، تمر، إلكترونيات، ساعة ذكية ≠ ساعة، دهن عود، عباية، عام)");
  {
    const sys = buildSeoSystem({ recent: [], keywords: ["عسل"], productName: "عسل سدر جبلي 500 جرام", category: "أغذية" });
    assert(/أسئلة قرار الشراء لهذه الفئة \(honey\)/.test(sys) && /نوع العسل ومصدره النباتي/.test(sys), "CS-9: البرومبت يحمل أسئلة قرار الفئة");
    assert(!/دعوة للفعل/.test(sys) && /بلا أي دعوة شراء أو فعل أمر/.test(sys) && !/"callToAction"/.test(sys) && !/"objectionKiller"/.test(sys), "CS-10: الميتا بلا دعوة شراء، ولا حقول دعوة حماسية أو اعتراض ضمان/شحن بالمخرج");
    assert(/جدول المواصفات يُنشر على صفحة المنتج/.test(sys) && /لا بلون العبوة أو شكلها/.test(sys), "CS-11: حفظ حقائق التاجر إلزامي، والعبوة ليست المنتج");
  }
}

main().then(done);

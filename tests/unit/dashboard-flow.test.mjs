// إعادة تنظيم لوحة التاجر (2026-09-13): ترتيب الخطوات، أدوات التوليد بمكان واحد،
// وصدق رسائل الحد اليومي. يحرس ألا ترجع الصفحة لترتيب «نموذج يدوي قبل المراجعة»
// ولا لنص «حصة الشهر» بعد أن صار الحد يومياً.
import { readFileSync } from "node:fs";
import { createRunner, readComposedPage } from "../_helpers.mjs";

const { assert, done } = createRunner("dashboard-flow");
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

async function main() {
  const dash = await readComposedPage("dashboard");
  const visible = dash.replace(/<!--[\s\S]*?-->/g, "");
  const bulk = read("../../public/js/dashboard/bulk.js");
  const catalog = read("../../public/js/dashboard/catalog.js");
  const review = read("../../public/js/dashboard/review.js");
  const store = read("../../public/js/dashboard/store.js");
  const studio = read("../../public/js/dashboard/studio.js");
  const head = read("../../partials/dashboard-head.html");

  // ── صدق الحد اليومي ──
  assert(!/حصة الشهر|الشهر الجاي|أول الشهر/.test(visible), "FLOW-1: لا وعد بحصة شهرية — الحد يومي");
  assert(/يُؤجَّل ويُكمَل تلقائياً يوماً بيوم/.test(visible), "FLOW-2: الزائد عن حد اليوم يُقال إنه مؤجَّل يوماً بيوم");
  assert(/باقي \$\{d\.remaining\} من \$\{d\.limit\}/.test(store) && /تتجدد كل يوم/.test(visible),
    "FLOW-3: عدّاد «أوصاف اليوم» يقول المتبقي صراحةً ويذكر التجدد اليومي");
  assert(/id="quotaExhaustedNote"/.test(visible) && /quotaExhaustedNote"\)\?\.classList\.toggle\("hidden", !\(d && d\.limit > 0 && d\.remaining <= 0\)\)/.test(store),
    "FLOW-4: نفاد أوصاف اليوم يظهر عند شريط التوليد، من أرقام الخادم لا رقم مكتوب");
  assert(!/data\.upgradeHint/.test(bulk), "FLOW-5: لا «رقّي الباقة» بلا مسار ترقية فعلي باللوحة");

  // ── ترتيب الخطوات بالصفحة ──
  const at = (id) => visible.indexOf(`id="${id}"`);
  const order = ["flowSteps", "catalogSelectBar", "catalogGrid", "copyResult", "reviewCard"].map(at);
  assert(order.every((i) => i > 0) && order.every((i, k) => k === 0 || i > order[k - 1]),
    "FLOW-6: الخطوات ← أدوات التوليد ← الشبكة ← لوحة الوصف ← المراجعة");
  assert(at("studioManual") > 0 && /id="studioManual"[^>]*\bhidden\b/.test(visible),
    "FLOW-7: نموذج الاستوديو مخفي افتراضياً — يظهره JS فقط بعد اختيار منتج حقيقي من «منتجاتي»");

  // ── أدوات التوليد بمكان واحد ──
  // readComposedPage يُلحق الـpartials الخام بعد الصفحة المبنية — العدّ على المبنية وحدها.
  const built = read("../../dist/dashboard.html");
  assert((built.match(/id="pTone"/g) || []).length === 1 && !/bulkTone/.test(visible + bulk + catalog),
    "FLOW-8: نبرة كتابة واحدة ظاهرة لكل مسارات التوليد");
  assert(at("pTone") > at("catalogSelectBar") && at("pTone") < at("catalogGrid"), "FLOW-9: النبرة بشريط «منتجاتي» لا داخل نموذج مطويّ");
  assert(at("bulkGenerateBtn") > at("catalogSelectBar") && at("bulkProgress") < at("catalogGrid"),
    "FLOW-10: «ولّد للكل» وشريط التقدّم فوق الشبكة");
  assert(/export async function pollBulkJob[\s\S]{0,200}bulkProgress"\)\?\.classList\.remove\("hidden"\)/.test(bulk),
    "FLOW-11: تتبّع أي وظيفة جماعية يُظهر شريط التقدّم (كان مخفياً بمسار المحدد)");

  // ── قرارات لا تُتخذ بضغطة عابرة ──
  assert(/if \(action === "approve_all"\) \{[\s\S]{0,400}confirmAction\(/.test(review),
    "FLOW-12: «اعتمد الكل» ينشر على متجر حي فيمرّ بتأكيد");
  assert(/const REVIEW_EMPTY = \{[\s\S]*publish_failed:/.test(review), "FLOW-13: حالة فارغة لكل تبويب مراجعة");
  assert(/S\.storeLinked === false/.test(catalog) && /S\.storeLinked = Boolean\(linked\)/.test(store),
    "FLOW-14: متجر غير مربوط ⇒ الفراغ يوجّه للربط لا لزر سحب سيفشل");
  assert(!/window\.scrollTo\(\{ top: 0/.test(studio) && /function regenerateCopy\(\)[\s\S]{0,200}openCopyPanel\(currentCatalogItem\(\)/.test(studio),
    "FLOW-15: «أعد التوليد» يعرض الانتظار مكان اللوحة لا أعلى الصفحة");

  // ── الوصولية ──
  assert(/button:focus-visible/.test(head), "FLOW-16: تركيز لوحة المفاتيح مرئي");
  assert(/aria-label="إغلاق لوحة الوصف"/.test(visible) && /setAttribute\("aria-label", "حدّد "/.test(catalog),
    "FLOW-17: أزرار الأيقونات ومربعات الاختيار موسومة لقارئ الشاشة");
}

main().then(done);

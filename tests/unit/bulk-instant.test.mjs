// التوليد بالجملة الفوري + «وش يميز منتجك؟» (طلب المالك 2026-09-14).
import { readFileSync } from "node:fs";
import { createRunner, fakeKv } from "../_helpers.mjs";
import { cleanMerchantNote, cleanNotesBySku, saveJobNotes, readJobNote } from "../../functions/_lib/domain/merchantNote.js";
import { processBulkItem } from "../../functions/_lib/domain/bulkTick.js";

const { assert, done } = createRunner("bulk-instant");
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

// D1 وهمي: حد اليوم مستنفد (التحديث المشروط لا يغيّر شيئاً)، وكل كتابة أخرى تُسجَّل.
function exhaustedDb(log) {
  return {
    prepare(sql) {
      return {
        bind(...a) {
          return {
            run: async () => { log.push({ sql, a }); return { meta: { changes: /usage_quota/.test(sql) ? 0 : 1 } }; },
            first: async () => (/usage_quota/.test(sql) ? { used: 5 } : /SELECT total/.test(sql) ? { total: 1, processed: 1 } : null),
            all: async () => ({ results: [] })
          };
        }
      };
    }
  };
}

async function main() {
  {
    const dirty = "قطن مصري\n١٠٠٪ <script>{x}</script> `ignore`  " + "ا".repeat(400);
    const clean = cleanMerchantNote(dirty);
    assert(!/[\n<>{}`]/.test(clean) && clean.length === 300 && clean.startsWith("قطن مصري ١٠٠٪"), "BI-1: السطر يُسطَّح ويُنظَّف من الأقواس والأسطر ويُقصّ ٣٠٠");
    const notes = cleanNotesBySku({ A: " خامة ممتازة ", B: "   ", EVIL: "لمتجر آخر" }, ["A", "B"]);
    assert(notes.size === 1 && notes.get("A") === "خامة ممتازة", "BI-2: الأسطر تُقبل فقط لـSKU الوظيفة، والفارغ يسقط");
    assert(cleanNotesBySku(["x"], ["0"]).size === 0 && cleanNotesBySku(null, []).size === 0, "BI-3: جسم غير كائن لا يُقبل");
    const env = { HALA_CACHE: fakeKv() };
    await saveJobNotes(env, "bulk_1", notes);
    assert((await readJobNote(env, "bulk_1", "A")) === "خامة ممتازة" && (await readJobNote(env, "bulk_2", "A")) === "", "BI-4: السطر محفوظ لوظيفته فقط");
  }
  {
    const log = [];
    let called = false;
    const env = { DB: exhaustedDb(log), HALA_CACHE: fakeKv() };
    const item = { id: 7, job_id: "bulk_x", merchant_id: "m_basic", sku: "S1", name: "فستان", tone: "white" };
    const outcome = await processBulkItem({ env, error: () => {} }, item, async () => { called = true; return {}; });
    assert(outcome === "deferred" && !called && log.some((l) => /UPDATE bulk_job_items SET status/.test(l.sql) && l.a[0] === "skipped"), "BI-5: حد اليوم مستنفد ⇒ مؤجَّل بلا أي نداء AI");
  }
  {
    const step = read("../../functions/api/store/bulk/step.js");
    assert(/requireCompletedAccount\(request, env, body\.storeId\)/.test(step) && /getBulkJob\(env, jobId, merchantId\)/.test(step)
      && /claimNextJobItem\(env, \{ jobId, merchantId \}\)/.test(step) && /processBulkItem\(/.test(step) && /checkRateLimit\(/.test(step),
    "BI-6: المعالجة الفورية بجلسة التاجر ووظيفته فقط، بحجز ذرّي وحد معدل");
    const bulk = read("../../functions/_lib/domain/bulk.js");
    assert(/WHERE id = \? AND status = 'pending' AND \(error IS NULL OR updated_at < datetime\('now', \?\)\)/.test(bulk)
      && /j\.merchant_id = \?/.test(bulk.slice(bulk.indexOf("export async function claimNextJobItem"))), "BI-7: الحجز مشروط (صف معلّق أو إيجار منتهٍ) ومقيّد بالتاجر");
    const tick = read("../../functions/_lib/domain/bulkTick.js");
    assert(/if \(!\(await claimBulkItem\(env, item\.id\)\)\) continue;/.test(tick) && /features: await readJobNote\(env, item\.job_id, item\.sku\)/.test(tick), "BI-8: الـcron يحجز قبل التوليد، والسطر يصل المولّد");
    const gen = read("../../functions/api/store/bulk/generate.js");
    assert(/saveJobNotes\(env, jobId, cleanNotesBySku\(body\.notes, rows\.map/.test(gen), "BI-9: بدء الجملة يحفظ الأسطر النظيفة لمنتجات الوظيفة");
    assert(/cleanMerchantNote\(body\.features, 500\)/.test(read("../../functions/api/copy.js")), "BI-10: المسار المفرد ينظّف السطر نفسه");
  }
  {
    const catalog = read("../../public/js/dashboard/catalog.js");
    const use = catalog.slice(catalog.indexOf("export function useCatalogItem"), catalog.indexOf("let askedItem"));
    assert(/askCatalogItemNote\(it\)/.test(use) && !/generateCopy\(\)/.test(use), "BI-11: اختيار منتج يسأل «وش يميزه؟» قبل تحليل الصورة");
    assert(/openNotesModal\(/.test(catalog) && /id="notesModal"/.test(read("../../partials/dashboard-modals.html")) && /id="copyAsk"/.test(read("../../partials/dashboard-studio.html")), "BI-12: نافذة الجملة وبطاقة المفرد موجودتان");
    assert(/if \(!list \|\| !\$\("notesModal"\) \|\| !\$\("notesQuota"\)\) \{ start\(\{\}\); return; \}/.test(read("../../public/js/dashboard/notes.js"))
      && /if \(!document\.getElementById\("copyAsk"\) \|\| !document\.getElementById\("copyAskNote"\)\) \{\s*openCopyPanel\(it\);\s*generateCopy\(\);/.test(catalog),
      "BI-15: HTML قديم من الكاش بلا العناصر الجديدة لا يوقف التوليد");
    const hdr = read("../../_headers");
    assert((hdr.match(/Cloudflare-CDN-Cache-Control: no-store/g) || []).length >= 2 && /^\/dashboard\r?$/m.test(hdr), "BI-16: لوحة التاجر لا تُخزَّن بكاش الحافة (HTML قديم مع JS جديد يوقف التوليد) — العدّ ≥٢ لأن /admin أُضيف 2026-09-17");
    const bulkJs = read("../../public/js/dashboard/bulk.js");
    const modal = read("../../public/js/dashboard/reviewModal.js");
    assert(/dispatchEvent\(new Event\("hala:review-ready"\)\)/.test(bulkJs) && /addEventListener\("hala:review-ready", appendReadyRows\)/.test(modal)
      && /M\.rows\.splice\(wasEmpty \? 0 : M\.index \+ 1, 0, \.\.\.fresh\)/.test(modal)
      && /setInterval\(\(\) => \{ if \(!document\.hidden\) appendReadyRows\(\); \}, LIVE_MS\)/.test(modal) && /stopLive\(\);/.test(modal) && /M\.decided\.add\(r\.id\)/.test(modal) && !/تجهز على دفعات/.test(modal), "BI-14: الوصف الجاهز يدخل الطابور بعد المنتج الحالي والنافذة مفتوحة (سؤال دوري + إشعار)، والمقرَّر لا يعود");
    assert(/postBulkStep\(jobId\)/.test(bulkJs) && /void driveJob\(jobId\)/.test(bulkJs) && !/خلال ~١٠ دقائق/.test(bulkJs), "BI-13: الصفحة تعالج فوراً بالتتابع بلا انتظار دفعة الـcron");
  }
}

main().then(done);

import { createRunner, readComposedPage } from "../_helpers.mjs";

const { assert, done } = createRunner("salla");

async function main() {
  // 8. Salla — the only storefront integration in scope
  const publishMod = await import("../../functions/api/store/publish.js");
  assert(typeof publishMod.onRequestPost === "function", "store/publish.js exports valid onRequestPost middleware");

  const sallaWebhookMod = await import("../../functions/api/webhooks/salla.js");
  assert(typeof sallaWebhookMod.onRequestPost === "function", "webhooks/salla.js exports valid onRequestPost middleware");

  // ── المرحلة ١: سحب كتالوج سلة (services/catalog.js + توجيه kind) ──────────
  {
    const { syncCatalogPage, listCatalog, getCatalogItem } = await import(
      "../../functions/_lib/domain/catalog.js"
    );

    // DB وهمي يسجّل كل استعلام مع قيمه المربوطة.
    function catalogDb(log) {
      const rec = (sql) => ({
        bind: (...args) => {
          log.push({ sql, args });
          return {
            run: async () => ({}),
            first: async () => null,
            all: async () => ({ results: [] }),
            _sql: sql,
            _args: args
          };
        }
      });
      return {
        prepare: rec,
        batch: async (stmts) => {
          for (const s of stmts) log.push({ sql: s._sql, args: s._args, batched: true });
          return [];
        }
      };
    }

    const page1 = {
      data: [
        { id: "1", sku: "SKU-A", name: "عباية", price: { amount: 300, currency: "SAR" }, description: "وصف أصلي", categories: [{ name: "عبايات" }] },
        { id: "2", name: "منتج بلا رمز", price: 100 },          // بلا SKU
        { id: "3", sku: "SKU-B", name: "شيلة" },
        { id: "4", sku: "   ", name: "رمز فاضي" }                // يُعدّ كذلك
      ],
      pagination: { currentPage: 1, totalPages: 2 }
    };

    const log = [];
    const res = await syncCatalogPage(
      { DB: catalogDb(log) },
      { merchantId: "m_a", page: 1, fetchPage: async () => page1 }
    );

    assert(res.imported === 2, "CAT-1: صفّان صالحان يُدرجان من الصفحة");
    assert(
      res.skippedNoSku === 2 && res.received === 4,
      "CAT-2: منتجات بلا SKU تُعدّ صراحةً (٢) ولا تُسقط صامتة"
    );
    assert(
      res.hasMore === true && res.nextPage === 2,
      "CAT-3: pagination تحدد الصفحة التالية — صفحة واحدة لكل تِك (حد سلة)"
    );

    const writes = log.filter((l) => l.batched && /INSERT INTO store_products/.test(l.sql));
    assert(
      writes.length === 2 && writes.every((w) => /merchant_id/.test(w.sql) && w.args[0] === "m_a"),
      "CAT-4: كل كتابة على store_products تحمل merchant_id للتاجر الصحيح"
    );
    assert(
      writes.every((w) => /ON CONFLICT\(merchant_id, sku\)/.test(w.sql)),
      "CAT-5: مفتاح التعارض (merchant_id, sku) — SKU مكرر بين متجرين لا يدهس"
    );
    // الوصف الأصلي محفوظ — بدونه ميزة التراجع مستحيلة (المخاطرة ٤ بالخطة).
    assert(
      writes[0].args.includes("وصف أصلي"),
      "CAT-6: current_description يحفظ الوصف الأصلي من سلة"
    );

    // آخر صفحة: بلا nextPage ⇒ الـcron ينهي الوظيفة.
    const last = await syncCatalogPage(
      { DB: catalogDb([]) },
      {
        merchantId: "m_a",
        page: 2,
        fetchPage: async () => ({ data: [{ sku: "S", name: "n" }], pagination: { currentPage: 2, totalPages: 2 } })
      }
    );
    assert(last.hasMore === false && last.nextPage === null, "CAT-7: آخر صفحة توقف السحب");

    // العزل: قراءة بلا merchantId ترمي (fail closed) لا ترجع كتالوج الجميع.
    let threw = false;
    try {
      await listCatalog({ DB: catalogDb([]) }, { merchantId: "" });
    } catch {
      threw = true;
    }
    assert(threw, "CAT-8: listCatalog بلا merchantId ترمي — لا قراءة عابرة للمستأجرين");

    const readLog = [];
    await listCatalog({ DB: catalogDb(readLog) }, { merchantId: "m_b", limit: 10 });
    await getCatalogItem({ DB: catalogDb(readLog) }, { merchantId: "m_b", sku: "SKU-A" });
    assert(
      readLog.length === 2 && readLog.every((r) => /merchant_id = \?/.test(r.sql) && r.args[0] === "m_b"),
      "CAT-9: كل قراءة من store_products مشروطة بـmerchant_id"
    );

    // التوجيه: وظيفة catalog_sync لا تُرى كصف توليد، والمسار الحالي سليم.
    const { claimNextCatalogSyncJob, getActiveJobByKind } = await import(
      "../../functions/_lib/domain/bulk.js"
    );
    const routeLog = [];
    const routeDb = {
      DB: {
        prepare: (sql) => ({
          bind: (...args) => {
            routeLog.push({ sql, args });
            return { first: async () => null, run: async () => ({}), all: async () => ({ results: [] }) };
          },
          first: async () => {
            routeLog.push({ sql, args: [] });
            return null;
          }
        })
      }
    };
    await claimNextCatalogSyncJob(routeDb);
    assert(
      routeLog.some((r) => /kind = 'catalog_sync'/.test(r.sql) && /status = 'running'/.test(r.sql)),
      "CAT-10: الـcron يلتقط وظائف catalog_sync فقط بالنوع — مسار seo_generate بلا مساس"
    );
    routeLog.length = 0;
    await getActiveJobByKind(routeDb, "m_c", "catalog_sync");
    assert(
      routeLog.length === 1 && /merchant_id = \?/.test(routeLog[0].sql) && routeLog[0].args[0] === "m_c",
      "CAT-11: فحص الوظيفة النشطة مشروط بالتاجر — يمنع وظيفة ثانية لنفس المتجر"
    );

    // ── الصفحة الأولى فوراً (تجربة التاجر) ───────────────────────────────
    // ثلاثة أشياء تُختبَر لأن كسرها مكلف:
    //  ١. **طلب سلة واحد** عند البدء — حلقة هنا تتجاوز ١ طلب/ثانية فتوقف
    //     اتصال المتجر كاملاً لا الطلب وحده.
    //  ٢. hasMore=false ⇒ **لا وظيفة** تنتظر تِكاً بلا شغل.
    //  ٣. فشل الصفحة الأولى ⇒ **لا وظيفة** توهم بنجاح ولا تحجز الحارس.
    const { syncFirstPage } = await import("../../functions/_lib/domain/catalogSync.js");

    /** env وهمي يسجّل كل كتابة على bulk_jobs (إنشاء الوظيفة/تقديم الـcursor). */
    function jobEnv(jobLog) {
      return {
        DB: {
          prepare: (sql) => ({
            bind: (...args) => {
              jobLog.push({ sql, args });
              return { run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) };
            }
          })
        }
      };
    }

    // متجر كبير: صفحة أولى + وظيفة للباقي، والـcursor على الصفحة ٢.
    const bigLog = [];
    let bigCalls = 0;
    const bigPages = [];
    const big = await syncFirstPage(jobEnv(bigLog), "m_a", {
      syncPage: async (_env, opts) => {
        bigCalls++;
        bigPages.push(opts.page);
        return { page: opts.page, received: 60, imported: 60, skippedNoSku: 0, hasMore: true, nextPage: 2 };
      }
    });
    assert(
      bigCalls === 1 && bigPages[0] === 1,
      "CAT-12: طلب سلة **واحد** عند البدء (الصفحة ١ فقط) — لا حلقة تتجاوز حد ١ طلب/ثانية"
    );
    assert(
      big.imported === 60 && big.hasMore === true && typeof big.jobId === "string",
      "CAT-13: متجر كبير — التاجر يشوف ٦٠ منتجاً فوراً ووظيفة تكمل الباقي"
    );
    assert(
      bigLog.some((r) => /INSERT INTO bulk_jobs/.test(r.sql) && r.args.includes("m_a")) &&
        bigLog.some((r) => /UPDATE bulk_jobs SET/.test(r.sql) && r.args[0] === "2"),
      "CAT-14: الوظيفة تُنشأ للتاجر نفسه والـcursor يبدأ من الصفحة ٢ — لا إعادة سحب الصفحة ١"
    );

    // متجر صغير: صفحة واحدة تكفي ⇒ لا وظيفة إطلاقاً.
    const smallLog = [];
    let smallCalls = 0;
    const small = await syncFirstPage(jobEnv(smallLog), "m_b", {
      syncPage: async () => {
        smallCalls++;
        return { page: 1, received: 12, imported: 12, skippedNoSku: 0, hasMore: false, nextPage: null };
      }
    });
    assert(
      smallCalls === 1 && small.imported === 12 && small.hasMore === false && small.jobId === null,
      "CAT-15: متجر بصفحة واحدة ينتهي فوراً — لا وظيفة معلّقة تنتظر cron بلا داعٍ"
    );
    assert(
      !smallLog.some((r) => /bulk_jobs/.test(r.sql)),
      "CAT-16: hasMore=false ⇒ صفر كتابات على bulk_jobs"
    );

    // فشل الصفحة الأولى: يُرمى للمستدعي، ولا وظيفة تُنشأ.
    const failLog = [];
    let failThrew = false;
    try {
      await syncFirstPage(jobEnv(failLog), "m_c", {
        syncPage: async () => {
          throw new Error("salla 401");
        }
      });
    } catch {
      failThrew = true;
    }
    assert(
      failThrew && !failLog.some((r) => /bulk_jobs/.test(r.sql)),
      "CAT-17: فشل الصفحة الأولى لا يُنشئ وظيفة — لا نجاح موهوم ولا حارس محجوز"
    );
  }

  // ── فك الربط بسلة + رسالة الخطأ + النص المختلط (2026-09-09) ──────────
  {
    const { readFileSync } = await import("node:fs");
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const { revokeSallaConnection, getSallaConnectionState } = await import("../../functions/_lib/domain/salla.js");
    const hookSrc = read("../../functions/_lib/domain/salla.js"); // المرحلة ٤: تصريف الأحداث بالمجال
    const dash = await readComposedPage("dashboard");

    assert(
      /case "app\.uninstalled":/.test(hookSrc) && /revokeSallaConnection\(env, merchantId\)/.test(hookSrc),
      "UNLINK-1: app.uninstalled معالَج ويستدعي فك الربط (كان مفقوداً كلياً)"
    );
    assert(
      /case "app\.subscription\.expired":/.test(hookSrc) && /case "app\.trial\.expired":/.test(hookSrc),
      "UNLINK-2: انتهاء الاشتراك/التجربة يُعامَل كفك ربط — لم يعد لنا إذن"
    );

    // التوكن يُحذف لا يُعطَّل، والمهام الجارية تُلغى، والختم يُسجَّل — بدفعة واحدة.
    const sqlLog = [];
    const revEnv = {
      DB: {
        prepare: (q) => ({ bind: (...b) => { sqlLog.push({ q: q.replace(/\s+/g, " ").trim(), b }); return { run: async () => ({}) }; } }),
        batch: async (st) => st
      }
    };
    const revOut = await revokeSallaConnection(revEnv, "m_test");
    assert(
      revOut.revoked === true && sqlLog.length === 3 &&
        /DELETE FROM oauth_tokens/.test(sqlLog[0].q) && /platform = 'salla'/.test(sqlLog[0].q) &&
        sqlLog[0].b[0] === "m_test",
      "UNLINK-3: توكنات سلة تُحذف (لا تُعطَّل) للتاجر وحده"
    );
    assert(
      /UPDATE bulk_jobs SET status = 'cancelled'/.test(sqlLog[1].q) && /status = 'running'/.test(sqlLog[1].q),
      "UNLINK-4: مهام الجملة الجارية تُلغى — لا cron يطرق باب متجر مغلق"
    );
    assert(
      /UPDATE merchants SET salla_disconnected_at/.test(sqlLog[2].q),
      "UNLINK-5: ختم وقت فك الربط يُسجَّل ليُعرض بصدق"
    );
    assert(
      (await revokeSallaConnection({}, "m_x")).revoked === false &&
        (await revokeSallaConnection(revEnv, "")).revoked === false,
      "UNLINK-6: بلا DB أو بلا تاجر لا كتابة ولا رمي"
    );

    const stEnv = (n, d) => ({ DB: { prepare: () => ({ bind: () => ({ first: async () => ({ n, d }) }) }) } });
    assert(
      (await getSallaConnectionState(stEnv(1, null), "m")).connected === true &&
        (await getSallaConnectionState(stEnv(0, "2026-09-09"), "m")).connected === false,
      "UNLINK-7: حالة الربط من وجود التوكن لا من عمود منفصل"
    );
    assert(
      /ADD COLUMN salla_disconnected_at/.test(read("../../migrations/0025_salla_disconnect.sql")),
      "UNLINK-8: هجرة 0025 تضيف salla_disconnected_at"
    );
    assert(
      /فك الربط وحذف البيانات/.test(dash) && /href="\/data-deletion"/.test(dash) && /href="\/privacy"/.test(dash),
      "UNLINK-9: الداشبورد يعرض فك الربط وحذف البيانات وسياسة الخصوصية"
    );

    assert(
      /bg-red-50/.test(dash) && /وصفك محفوظ هنا كما هو/.test(dash),
      "ERRUI-1: فشل النشر يظهر كخطأ صريح مع طمأنة أن الوصف لم يضع"
    );
    assert(
      /SALLA_RATE_LIMITED: (['"])/.test(dash) && /showPublishError\(data\?\.error, data\?\.code\)/.test(dash),
      "ERRUI-2: رموز أخطاء سلة تُترجم لرسائل عربية بخطوة تالية"
    );
    assert(
      !/showPublishError\('تعذر الاتصال\.'\)/.test(dash) && /تأكد من الإنترنت وجرّب مرة ثانية/.test(dash),
      "ERRUI-3: انقطاع الشبكة رسالته تقول ما يفعله التاجر"
    );

    assert(
      /id="outSlug" dir="auto"/.test(dash),
      "BIDI-2: الرابط العربي بخط مونو له اتجاه صريح"
    );
    assert(
      /<bdi>\$\{escHtml\(r\.sku \|\| (['"])\1\)\}<\/bdi>/.test(dash),
      "BIDI-3: بطاقة المنتج تعزل SKU عن الفئة العربية"
    );
  }

  // ── أول سحب فور الربط (2026-09-09: "الواجهة ما تطلع منتجات" = متجر جديد بلا سحب) ──
  {
    const { readFileSync } = await import("node:fs");
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    // المرحلة ٤: نقطة الدخول تنسيق فقط — الحدث بـdomain/salla.js وأول سحب بـdomain/catalogSync.js.
    const hookSrc = read("../../functions/api/webhooks/salla.js");
    const eventSrc = read("../../functions/_lib/domain/salla.js");
    const syncSrc = read("../../functions/_lib/domain/catalogSync.js");
    assert(
      /import \{ kickoffFirstSync \} from "\.\.\/\.\.\/_lib\/domain\/catalogSync\.js"/.test(hookSrc) &&
        /onFirstSync: \(id\) => kickoffFirstSync\(env, id,/.test(hookSrc) &&
        /await onFirstSync\(merchantId\)/.test(eventSrc),
      "FIRSTSYNC-1: app.store.authorize يطلق أول سحب بلا انتظار ضغطة زر"
    );
    assert(
      /getActiveJobByKind\(env, merchantId, "catalog_sync"\)/.test(syncSrc),
      "FIRSTSYNC-2: سحب شغّال أصلاً ⇒ لا سحب ثانٍ (حد سلة ١ طلب/ثانية)"
    );
    assert(
      /SALLA_FIRST_SYNC_FAILED/.test(syncSrc) && /catch \(err\)/.test(syncSrc),
      "FIRSTSYNC-3: فشل السحب الأول يُسجَّل ولا يُفشل الويبهوك — التوكن يبقى محفوظاً"
    );
    assert(
      /UPDATE merchants SET salla_disconnected_at = NULL WHERE id = \?/.test(eventSrc),
      "FIRSTSYNC-4: إعادة التثبيت تصفّر ختم فك الربط — لا يُعرض متجر مربوط كمفكوك"
    );
    // الاستيراد لا يخلق حلقة: مسار السحب لا يعرف الويبهوك.
    assert(
      !/webhooks\/salla/.test(syncSrc),
      "FIRSTSYNC-5: لا استيراد دائري بين الويبهوك ومسار السحب"
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

  // ── الحذف النهائي عند إزالة التطبيق (وعد فيديو الاستخدام) 2026-09-10 ──
  {
    const { readFileSync, readdirSync } = await import("node:fs");
    const readT = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const { purgeMerchantData, PURGE_TABLES, PURGE_EXEMPT } =
      await import("../../functions/_lib/domain/merchantPurge.js");

    // الحارس الأهم: كل جدول فيه merchant_id إمّا يُمحى أو له إعفاء موثّق.
    const migDir = new URL("../../migrations/", import.meta.url);
    const tenant = new Set();
    for (const f of readdirSync(migDir).sort()) {
      const sql = readFileSync(new URL(f, migDir), "utf8");
      const re = /CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_]+)\s*\(([\s\S]*?)\n\);/gi;
      let m;
      while ((m = re.exec(sql))) if (/merchant_id/i.test(m[2])) tenant.add(m[1]);
      const alt = /ALTER TABLE\s+([a-z_]+)\s+ADD COLUMN\s+merchant_id/gi;
      while ((m = alt.exec(sql))) tenant.add(m[1]);
    }
    const covered = new Set([...PURGE_TABLES, ...Object.keys(PURGE_EXEMPT)]);
    const escaped = [...tenant].filter((t) => !covered.has(t));
    assert(
      escaped.length === 0,
      `PURGE-1: كل جدول تاجر يُمحى أو له إعفاء موثّق (الهارب: ${escaped.join(", ") || "لا شيء"})`
    );

    // لا جدول بالقائمة غير موجود أصلاً — قائمة ميتة تعني حذفاً وهمياً.
    const ghost = PURGE_TABLES.filter((t) => !tenant.has(t));
    assert(ghost.length === 0, `PURGE-2: لا جدول بالقائمة بلا هجرة (${ghost.join(", ") || "لا شيء"})`);

    // كل حذف مشروط بالتاجر — لا مسح عابر للمتاجر.
    const sql = [];
    const env = {
      DB: {
        prepare: (q) => ({
          bind: (...b) => { sql.push({ q: q.replace(/\s+/g, " ").trim(), b }); return { run: async () => ({}) }; },
          run: async () => ({})
        })
      }
    };
    const out = await purgeMerchantData(env, "m_x");
    const deletes = sql.filter((c) => /^DELETE FROM/.test(c.q) && !/^DELETE FROM error_log/.test(c.q));
    assert(
      sql.some((c) => /^DELETE FROM error_log WHERE store_id = \?$/.test(c.q) && c.b[0] === "m_x"),
      "PURGE-5: سجل تشخيص المتجر (فيه نص صفحات منتجاته مؤقتاً) يُمحى مع بياناته بـstore_id"
    );
    assert(
      out.purged === true && deletes.length === PURGE_TABLES.length &&
        deletes.every((c) => /WHERE merchant_id = \?/.test(c.q) && c.b[0] === "m_x"),
      "PURGE-3: كل حذف مقيَّد بـmerchant_id — لا مسح عابر للمتاجر"
    );
    assert(
      sql.some((c) => /UPDATE merchants SET store_name = NULL/.test(c.q) && c.b[0] === "m_x"),
      "PURGE-4: صف التاجر يُفرَّغ ولا يُحذف — إعادة الربط تبقى ممكنة"
    );
    assert(
      (await purgeMerchantData({}, "m")).purged === false &&
        (await purgeMerchantData(env, "")).purged === false,
      "PURGE-5: بلا DB أو بلا تاجر لا حذف ولا رمي"
    );

    // الحذف على app.uninstalled وحده — انتهاء الاشتراك ليس طلب حذف.
    const dom = readT("../../functions/_lib/domain/salla.js");
    const uninstallBlock = dom.slice(dom.indexOf('case "app.uninstalled"'), dom.indexOf('case "abandoned.cart"'));
    assert(
      /purgeMerchantData\(env, merchantId\)/.test(uninstallBlock) &&
        uninstallBlock.indexOf("purgeMerchantData") < uninstallBlock.indexOf('case "app.subscription.expired"'),
      "PURGE-6: الحذف على app.uninstalled فقط، لا على انتهاء الاشتراك"
    );
    assert(
      /MERCHANT_PURGE_PARTIAL/.test(dom),
      "PURGE-7: فشل جزئي بالحذف يُسجَّل — لا ادعاء حذف كامل بلا دليل"
    );
    // الواجهة تقول ما يحدث فعلاً.
    const store = readT("../../partials/dashboard-store.html");
    assert(
      /تُحذف[\s\S]{0,40}بياناتك كلها من عندنا نهائياً/.test(store) &&
        !/أوصافك المولَّدة تبقى محفوظة هنا/.test(store),
      "PURGE-8: بطاقة اللوحة تطابق السلوك الجديد — لا وعد متناقض"
    );
  }
